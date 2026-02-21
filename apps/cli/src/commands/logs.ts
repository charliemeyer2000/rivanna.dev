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
  }

  // Pull mode: download log files
  if (options.pull) {
    if (!isJson) {
      console.log(theme.info("\nDownloading log files..."));
    }

    for (const remotePath of [outPath, errPath]) {
      try {
        await slurm.sshClient.rsyncPull(remotePath, ".", {});
        if (!isJson) {
          const filename = remotePath.split("/").pop();
          console.log(theme.success(`  Downloaded ${filename}`));
        }
      } catch {
        // File might not exist (e.g., no stderr)
      }
    }

    if (isJson) {
      console.log(JSON.stringify({ pulled: true, jobId: targetJobId }));
    }
    return;
  }

  // Follow mode or static read
  const jobs = await slurm.getJobs();
  const job = jobs.find((j) => j.id === targetJobId);
  const isRunning = job?.state === "RUNNING" || job?.state === "PENDING";
  const shouldFollow = options.follow || isRunning;

  if (shouldFollow) {
    await tailJobLogs(slurm, targetJobId, outPath, errPath, {
      silent: isJson,
      stream,
    });
  } else {
    // One-shot read
    if (stream === "both" || stream === "out") {
      const content = await slurm.sshClient
        .exec(`cat ${outPath} 2>/dev/null || true`)
        .catch(() => "");
      if (isJson) {
        console.log(
          JSON.stringify({ jobId: targetJobId, logPath: outPath, content }),
        );
      } else if (content) {
        console.log(content);
      }
    }

    if (stream === "both" || stream === "err") {
      const content = await slurm.sshClient
        .exec(`cat ${errPath} 2>/dev/null || true`)
        .catch(() => "");
      if (isJson) {
        console.log(
          JSON.stringify({ jobId: targetJobId, logPath: errPath, content }),
        );
      } else if (content) {
        console.log(content);
      }
    }
  }
}
