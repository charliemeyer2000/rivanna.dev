import type { Command } from "commander";
import ora from "ora";
import { PATHS } from "@rivanna/shared";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import { tailJobLogs, type LogStream } from "@/core/log-tailer.ts";

interface LogsOptions {
  out?: boolean;
  err?: boolean;
  pull?: boolean;
  follow?: boolean;
  json?: boolean;
  node?: string;
}

export function registerLogsCommand(program: Command) {
  program
    .command("logs")
    .description("View job output logs")
    .argument("[jobId]", "job to view (default: most recent)")
    .option("--out", "show stdout only")
    .option("--err", "show stderr only")
    .option("--pull", "download log files locally")
    .option("-f, --follow", "follow log output (default for running jobs)")
    .option("--node <index>", "show specific node (multi-node jobs)")
    .option("--json", "output as JSON")
    .action(async (jobId: string | undefined, options: LogsOptions) => {
      try {
        await runLogs(jobId, options);
      } catch (error) {
        if (options.json) {
          console.log(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        } else if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

async function resolveLogPath(
  slurm: import("@/core/slurm.ts").SlurmClient,
  jobId: string,
  user: string,
  ext: string,
): Promise<string> {
  // Try squeue first (active jobs have name)
  const jobs = await slurm.getJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (job) {
    return `${PATHS.logs(user)}/${job.name}-${jobId}.${ext}`;
  }

  // For completed jobs, glob for the log file
  const logDir = PATHS.logs(user);
  const globResult = await slurm.sshClient
    .exec(`ls ${logDir}/*-${jobId}.${ext} 2>/dev/null || true`)
    .catch(() => "");

  const firstMatch = globResult.trim().split("\n")[0];
  if (firstMatch && firstMatch.length > 0) {
    return firstMatch;
  }

  // Fallback
  return `${logDir}/rv-${jobId}.${ext}`;
}

/**
 * Detect how many per-node log files exist for a job.
 * Returns 0 if no per-node files found (single-node or old job).
 */
async function detectNodeCount(
  slurm: import("@/core/slurm.ts").SlurmClient,
  basePath: string,
): Promise<number> {
  const dotIdx = basePath.lastIndexOf(".");
  const base = basePath.slice(0, dotIdx);
  const ext = basePath.slice(dotIdx + 1);
  const result = await slurm.sshClient
    .exec(`ls ${base}.node*.${ext} 2>/dev/null | wc -l`)
    .catch(() => "0");
  return parseInt(result.trim(), 10) || 0;
}

function resolveStream(options: LogsOptions): LogStream {
  if (options.out && options.err) return "both";
  if (options.out) return "out";
  if (options.err) return "err";
  return "both";
}

async function runLogs(jobId: string | undefined, options: LogsOptions) {
  const { config, slurm } = ensureSetup();
  const isJson = !!options.json;
  const user = config.connection.user;
  const stream = resolveStream(options);
  const nodeFilter =
    options.node !== undefined ? parseInt(options.node, 10) : undefined;

  let targetJobId = jobId;

  if (!targetJobId) {
    const spinner = isJson ? null : ora("Finding jobs...").start();
    const jobs = await slurm.getJobs();
    spinner?.stop();

    if (jobs.length > 0) {
      // Prefer running, then most recent
      const running = jobs.filter((j) => j.state === "RUNNING");
      const target = running.length > 0 ? running : jobs;
      targetJobId = target.sort((a, b) => parseInt(b.id) - parseInt(a.id))[0]!
        .id;
    } else {
      // Try recent history
      const history = await slurm.getJobHistory("now-1day");
      if (history.length === 0) {
        throw new Error("No recent jobs found.");
      }
      targetJobId = history.sort((a, b) => parseInt(b.id) - parseInt(a.id))[0]!
        .id;
    }
  }

  const outPath = await resolveLogPath(slurm, targetJobId, user, "out");
  const errPath = await resolveLogPath(slurm, targetJobId, user, "err");

  // Detect multi-node: probe for per-node files
  const nodeCount = await detectNodeCount(slurm, outPath);

  // Validate --node range
  if (nodeFilter !== undefined && nodeCount > 0 && nodeFilter >= nodeCount) {
    throw new Error(
      `Node index ${nodeFilter} out of range (job has ${nodeCount} nodes)`,
    );
  }

  // Show header
  if (!isJson) {
    const jobs = await slurm.getJobs();
    const job = jobs.find((j) => j.id === targetJobId);
    if (job) {
      console.log(theme.muted(`Job ${job.id}: ${job.name} (${job.state})`));
      console.log(theme.muted(`  ${job.gres} on ${job.nodes.join(", ")}`));
    } else {
      console.log(theme.muted(`Job ${targetJobId}`));
    }
    if (nodeCount > 0) {
      console.log(
        theme.muted(
          `  ${nodeCount} node${nodeCount > 1 ? "s" : ""} (per-node logs)`,
        ),
      );
    }
  }

  // Pull mode: download log files
  if (options.pull) {
    if (!isJson) {
      console.log(theme.info("\nDownloading log files..."));
    }

    // Download sbatch-level files
    for (const remotePath of [outPath, errPath]) {
      try {
        await slurm.sshClient.rsyncPull(remotePath, ".", {});
        if (!isJson) {
          const filename = remotePath.split("/").pop();
          console.log(theme.success(`  Downloaded ${filename}`));
        }
      } catch {
        // File might not exist
      }
    }

    // Download per-node files if they exist
    if (nodeCount > 0) {
      for (let i = 0; i < nodeCount; i++) {
        for (const basePath of [outPath, errPath]) {
          const dotIdx = basePath.lastIndexOf(".");
          const base = basePath.slice(0, dotIdx);
          const ext = basePath.slice(dotIdx);
          const nodePath = `${base}.node${i}${ext}`;
          try {
            await slurm.sshClient.rsyncPull(nodePath, ".", {});
            if (!isJson) {
              const filename = nodePath.split("/").pop();
              console.log(theme.success(`  Downloaded ${filename}`));
            }
          } catch {
            // File might not exist
          }
        }
      }
    }

    if (isJson) {
      console.log(
        JSON.stringify({ pulled: true, jobId: targetJobId, nodeCount }),
      );
    }
    return;
  }

  // Follow mode or static read
  const shouldFollow = options.follow ?? false;

  if (shouldFollow) {
    await tailJobLogs(slurm, targetJobId, outPath, errPath, {
      silent: isJson,
      stream,
      nodeCount: nodeCount > 0 ? nodeCount : undefined,
      nodeFilter,
    });
  } else {
    // One-shot read
    if (nodeCount > 0) {
      await readMultiNodeLogs(
        slurm,
        targetJobId,
        outPath,
        errPath,
        nodeCount,
        nodeFilter,
        stream,
        isJson,
      );
    } else {
      await readSingleNodeLogs(
        slurm,
        targetJobId,
        outPath,
        errPath,
        stream,
        isJson,
      );
    }
  }
}

async function readSingleNodeLogs(
  slurm: import("@/core/slurm.ts").SlurmClient,
  jobId: string,
  outPath: string,
  errPath: string,
  stream: LogStream,
  isJson: boolean,
): Promise<void> {
  if (stream === "both" || stream === "out") {
    const content = await slurm.sshClient
      .exec(`cat ${outPath} 2>/dev/null || true`)
      .catch(() => "");
    if (isJson) {
      console.log(JSON.stringify({ jobId, logPath: outPath, content }));
    } else if (content) {
      console.log(content);
    }
  }

  if (stream === "both" || stream === "err") {
    const content = await slurm.sshClient
      .exec(`cat ${errPath} 2>/dev/null || true`)
      .catch(() => "");
    if (isJson) {
      console.log(JSON.stringify({ jobId, logPath: errPath, content }));
    } else if (content) {
      console.log(content);
    }
  }
}

async function readMultiNodeLogs(
  slurm: import("@/core/slurm.ts").SlurmClient,
  jobId: string,
  outPath: string,
  errPath: string,
  nodeCount: number,
  nodeFilter: number | undefined,
  stream: LogStream,
  isJson: boolean,
): Promise<void> {
  const trackOut = stream === "out" || stream === "both";
  const trackErr = stream === "err" || stream === "both";

  for (let i = 0; i < nodeCount; i++) {
    if (nodeFilter !== undefined && i !== nodeFilter) continue;

    const dotOutIdx = outPath.lastIndexOf(".");
    const dotErrIdx = errPath.lastIndexOf(".");
    const nodeOutPath = `${outPath.slice(0, dotOutIdx)}.node${i}${outPath.slice(dotOutIdx)}`;
    const nodeErrPath = `${errPath.slice(0, dotErrIdx)}.node${i}${errPath.slice(dotErrIdx)}`;
    const prefix = theme.muted(`[node${i}] `);

    if (trackOut) {
      const content = await slurm.sshClient
        .exec(`cat ${nodeOutPath} 2>/dev/null || true`)
        .catch(() => "");
      if (isJson) {
        console.log(
          JSON.stringify({ jobId, node: i, logPath: nodeOutPath, content }),
        );
      } else if (content) {
        for (const line of content.split("\n")) {
          console.log(prefix + line);
        }
      }
    }

    if (trackErr) {
      const content = await slurm.sshClient
        .exec(`cat ${nodeErrPath} 2>/dev/null || true`)
        .catch(() => "");
      if (isJson) {
        console.log(
          JSON.stringify({ jobId, node: i, logPath: nodeErrPath, content }),
        );
      } else if (content) {
        for (const line of content.split("\n")) {
          console.log(prefix + line);
        }
      }
    }
  }
}
