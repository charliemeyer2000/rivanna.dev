import type { SlurmClient } from "./slurm.ts";
import { TERMINAL_STATES } from "@rivanna/shared";
import { theme } from "@/lib/theme.ts";

export type LogStream = "out" | "err" | "both";

export interface JobResult {
  finalState: string;
  exitCode: number;
}

/**
 * Derive per-node file paths from a base path.
 * Example: "job-123.out" → ["job-123.node0.out", "job-123.node1.out"]
 */
function deriveNodePaths(basePath: string, nodeCount: number): string[] {
  const dotIdx = basePath.lastIndexOf(".");
  const base = basePath.slice(0, dotIdx);
  const ext = basePath.slice(dotIdx);
  return Array.from({ length: nodeCount }, (_, i) => `${base}.node${i}${ext}`);
}

export function stripProgressLines(content: string): string {
  return content
    .split("\n")
    .filter((line) => !line.includes("\r") && !/\d+%\|.*\|/.test(line))
    .join("\n");
}

export async function tailJobLogs(
  slurm: SlurmClient,
  jobId: string,
  outPath: string,
  errPath: string,
  options?: {
    silent?: boolean;
    stream?: LogStream;
    nodeCount?: number;
    nodeFilter?: number;
    raw?: boolean;
  },
): Promise<JobResult> {
  const stream = options?.stream ?? "both";
  const nodeCount = options?.nodeCount ?? 1;
  const nodeFilter = options?.nodeFilter;
  const raw = options?.raw ?? false;
  const isMultiNode = nodeCount > 1;

  if (isMultiNode) {
    return tailMultiNode(slurm, jobId, outPath, errPath, {
      silent: options?.silent,
      stream,
      nodeCount,
      nodeFilter,
      raw,
    });
  }

  return tailSingleNode(slurm, jobId, outPath, errPath, {
    silent: options?.silent,
    stream,
    raw,
  });
}

// --------------- Single-node tailing ---------------

async function tailSingleNode(
  slurm: SlurmClient,
  jobId: string,
  outPath: string,
  errPath: string,
  options: { silent?: boolean; stream: LogStream; raw?: boolean },
): Promise<JobResult> {
  const { stream, raw } = options;
  const trackOut = stream === "out" || stream === "both";
  const trackErr = stream === "err" || stream === "both";

  let lastOutLines = 0;
  let lastErrLines = 0;

  if (!options.silent) {
    const label =
      stream === "both"
        ? `stdout + stderr`
        : stream === "out"
          ? "stdout"
          : "stderr";
    console.log(theme.muted(`\n  Tailing ${label}...`));
    console.log();
  }

  async function fetchNewLines(
    prevOut: number,
    prevErr: number,
  ): Promise<{ outLines: number; errLines: number }> {
    const countCmds: string[] = [];
    if (trackOut) countCmds.push(`wc -l < ${outPath} 2>/dev/null || echo 0`);
    if (trackErr) countCmds.push(`wc -l < ${errPath} 2>/dev/null || echo 0`);

    const countResults = await slurm.sshClient
      .execBatch(countCmds)
      .catch(() => countCmds.map(() => "0"));

    let idx = 0;
    const outTotal = trackOut ? parseInt(countResults[idx++] ?? "0", 10) : 0;
    const errTotal = trackErr ? parseInt(countResults[idx++] ?? "0", 10) : 0;

    const readCmds: Array<{ cmd: string; isErr: boolean }> = [];
    if (trackOut && outTotal > prevOut) {
      readCmds.push({
        cmd: `tail -n +${prevOut + 1} ${outPath} 2>/dev/null | head -n ${outTotal - prevOut}`,
        isErr: false,
      });
    }
    if (trackErr && errTotal > prevErr) {
      readCmds.push({
        cmd: `tail -n +${prevErr + 1} ${errPath} 2>/dev/null | head -n ${errTotal - prevErr}`,
        isErr: true,
      });
    }

    if (readCmds.length > 0 && !options.silent) {
      const readResults = await slurm.sshClient
        .execBatch(readCmds.map((r) => r.cmd))
        .catch(() => readCmds.map(() => ""));

      for (let i = 0; i < readCmds.length; i++) {
        let content = readResults[i];
        if (!content) continue;
        if (!raw) content = stripProgressLines(content);
        if (!content) continue;
        if (readCmds[i]!.isErr && stream === "both") {
          for (const line of content.split("\n")) {
            if (line.length === 0) continue;
            process.stdout.write(theme.error("[stderr] ") + line + "\n");
          }
        } else {
          process.stdout.write(content + "\n");
        }
      }
    }

    return { outLines: outTotal, errLines: errTotal };
  }

  while (true) {
    const jobs = await slurm.getJobs();
    const job = jobs.find((j) => j.id === jobId);

    const counts = await fetchNewLines(lastOutLines, lastErrLines);
    lastOutLines = counts.outLines;
    lastErrLines = counts.errLines;

    if (!job || TERMINAL_STATES.has(job.state)) {
      await fetchNewLines(lastOutLines, lastErrLines);
      return resolveJobResult(slurm, jobId, job?.state, options.silent);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

// --------------- Multi-node tailing ---------------

interface NodeFile {
  nodeIndex: number;
  type: "out" | "err";
  path: string;
  lastLines: number;
}

async function tailMultiNode(
  slurm: SlurmClient,
  jobId: string,
  outPath: string,
  errPath: string,
  options: {
    silent?: boolean;
    stream: LogStream;
    nodeCount: number;
    nodeFilter?: number;
    raw?: boolean;
  },
): Promise<JobResult> {
  const { stream, nodeCount, nodeFilter, raw } = options;
  const trackOut = stream === "out" || stream === "both";
  const trackErr = stream === "err" || stream === "both";

  // Build list of per-node files to track
  const outPaths = deriveNodePaths(outPath, nodeCount);
  const errPaths = deriveNodePaths(errPath, nodeCount);

  const nodeFiles: NodeFile[] = [];
  for (let i = 0; i < nodeCount; i++) {
    if (nodeFilter !== undefined && i !== nodeFilter) continue;
    if (trackOut) {
      nodeFiles.push({
        nodeIndex: i,
        type: "out",
        path: outPaths[i]!,
        lastLines: 0,
      });
    }
    if (trackErr) {
      nodeFiles.push({
        nodeIndex: i,
        type: "err",
        path: errPaths[i]!,
        lastLines: 0,
      });
    }
  }

  // Track whether we've fallen back to sbatch-level files
  let usingFallback = false;
  let fallbackOutLines = 0;
  let fallbackErrLines = 0;
  let pollCount = 0;

  if (!options.silent) {
    const nodeLabel =
      nodeFilter !== undefined ? `node ${nodeFilter}` : `${nodeCount} nodes`;
    const streamLabel =
      stream === "both"
        ? `stdout + stderr`
        : stream === "out"
          ? "stdout"
          : "stderr";
    console.log(theme.muted(`\n  Tailing ${streamLabel} (${nodeLabel})...`));
    console.log();
  }

  async function fetchNewLines(): Promise<void> {
    if (usingFallback) {
      // Fallback: tail sbatch-level files (same as single-node)
      await fetchFallbackLines();
      return;
    }

    // Count lines in all tracked per-node files
    const countCmds = nodeFiles.map(
      (nf) => `wc -l < ${nf.path} 2>/dev/null || echo 0`,
    );
    const countResults = await slurm.sshClient
      .execBatch(countCmds)
      .catch(() => countCmds.map(() => "0"));

    // Parse counts and check if any files have content
    const totals: number[] = [];
    let anyContent = false;
    for (let i = 0; i < nodeFiles.length; i++) {
      const total = parseInt(countResults[i] ?? "0", 10);
      totals.push(total);
      if (total > 0) anyContent = true;
    }

    // Preamble fallback: if no per-node files have content after a few polls,
    // check sbatch-level .err for preamble errors
    if (!anyContent && pollCount >= 2) {
      const errCheck = await slurm.sshClient
        .exec(`wc -l < ${errPath} 2>/dev/null || echo 0`)
        .catch(() => "0");
      if (parseInt(errCheck.trim(), 10) > 0) {
        usingFallback = true;
        await fetchFallbackLines();
        return;
      }
    }

    // Read new lines from files that grew
    const readCmds: Array<{ nodeFile: NodeFile; cmd: string }> = [];
    for (let i = 0; i < nodeFiles.length; i++) {
      const nf = nodeFiles[i]!;
      const total = totals[i]!;
      if (total > nf.lastLines) {
        readCmds.push({
          nodeFile: nf,
          cmd: `tail -n +${nf.lastLines + 1} ${nf.path} 2>/dev/null | head -n ${total - nf.lastLines}`,
        });
      }
    }

    if (readCmds.length > 0 && !options.silent) {
      const readResults = await slurm.sshClient
        .execBatch(readCmds.map((r) => r.cmd))
        .catch(() => readCmds.map(() => ""));

      for (let i = 0; i < readCmds.length; i++) {
        let content = readResults[i];
        if (!content) continue;
        if (!raw) content = stripProgressLines(content);
        if (!content) continue;

        const { nodeFile } = readCmds[i]!;
        const prefix = theme.muted(`[node${nodeFile.nodeIndex}] `);
        const errPrefix =
          nodeFile.type === "err" && stream === "both"
            ? theme.error("[stderr] ")
            : "";
        const lines = content.split("\n");
        for (const line of lines) {
          if (line.length === 0 && lines.indexOf(line) === lines.length - 1)
            continue;
          process.stdout.write(prefix + errPrefix + line + "\n");
        }
      }
    }

    // Update tracked line counts
    for (let i = 0; i < nodeFiles.length; i++) {
      nodeFiles[i]!.lastLines = totals[i]!;
    }
  }

  async function fetchFallbackLines(): Promise<void> {
    // Same logic as single-node but for sbatch-level files
    const countCmds: string[] = [];
    if (trackOut) countCmds.push(`wc -l < ${outPath} 2>/dev/null || echo 0`);
    if (trackErr) countCmds.push(`wc -l < ${errPath} 2>/dev/null || echo 0`);

    const countResults = await slurm.sshClient
      .execBatch(countCmds)
      .catch(() => countCmds.map(() => "0"));

    let idx = 0;
    const outTotal = trackOut ? parseInt(countResults[idx++] ?? "0", 10) : 0;
    const errTotal = trackErr ? parseInt(countResults[idx++] ?? "0", 10) : 0;

    const readCmds: Array<{ cmd: string; isErr: boolean }> = [];
    if (trackOut && outTotal > fallbackOutLines) {
      readCmds.push({
        cmd: `tail -n +${fallbackOutLines + 1} ${outPath} 2>/dev/null | head -n ${outTotal - fallbackOutLines}`,
        isErr: false,
      });
    }
    if (trackErr && errTotal > fallbackErrLines) {
      readCmds.push({
        cmd: `tail -n +${fallbackErrLines + 1} ${errPath} 2>/dev/null | head -n ${errTotal - fallbackErrLines}`,
        isErr: true,
      });
    }

    if (readCmds.length > 0 && !options.silent) {
      const readResults = await slurm.sshClient
        .execBatch(readCmds.map((r) => r.cmd))
        .catch(() => readCmds.map(() => ""));
      for (let i = 0; i < readResults.length; i++) {
        let content = readResults[i];
        if (!content) continue;
        if (!raw) content = stripProgressLines(content);
        if (!content) continue;
        if (readCmds[i]!.isErr && stream === "both") {
          for (const line of content.split("\n")) {
            if (line.length === 0) continue;
            process.stdout.write(theme.error("[stderr] ") + line + "\n");
          }
        } else {
          process.stdout.write(content + "\n");
        }
      }
    }

    fallbackOutLines = outTotal;
    fallbackErrLines = errTotal;
  }

  while (true) {
    const jobs = await slurm.getJobs();
    const job = jobs.find((j) => j.id === jobId);

    await fetchNewLines();
    pollCount++;

    if (!job || TERMINAL_STATES.has(job.state)) {
      // Final flush
      await fetchNewLines();
      return resolveJobResult(slurm, jobId, job?.state, options.silent);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

// --------------- Shared exit resolution ---------------

async function resolveJobResult(
  slurm: SlurmClient,
  jobId: string,
  jobState: string | undefined,
  silent?: boolean,
): Promise<JobResult> {
  let finalState = jobState;
  let exitCode: number | undefined;

  if (!finalState || finalState === "COMPLETING" || finalState === "UNKNOWN") {
    const info = await slurm.getJobState(jobId);
    if (info) {
      exitCode = info.exitCode;
      if (info.state === "COMPLETING") {
        finalState = info.exitCode ? "FAILED" : "COMPLETED";
      } else {
        finalState = (info.state as typeof finalState) ?? "COMPLETED";
      }
    } else {
      finalState = "COMPLETED";
    }
  } else if (finalState !== "COMPLETED") {
    const info = await slurm.getJobState(jobId);
    if (info) exitCode = info.exitCode;
  }

  if (!silent) {
    const stateColor = finalState === "COMPLETED" ? theme.success : theme.error;
    console.log(
      theme.muted(`\n  Job ${jobId} finished (`) +
        stateColor(finalState) +
        theme.muted(")."),
    );
  }

  const resolvedExitCode =
    exitCode !== undefined ? exitCode : finalState === "COMPLETED" ? 0 : 1;

  return { finalState: finalState!, exitCode: resolvedExitCode };
}
