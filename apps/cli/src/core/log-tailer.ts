import type { SlurmClient } from "./slurm.ts";
import { TERMINAL_STATES } from "@rivanna/shared";
import { theme } from "@/lib/theme.ts";

export type LogStream = "out" | "err" | "both";

/**
 * Tail a job's log files, printing new lines as they appear.
 * Polls every 3 seconds until the job finishes.
 *
 * When streaming both, stderr lines are printed in red.
 */
export async function tailJobLogs(
  slurm: SlurmClient,
  jobId: string,
  outPath: string,
  errPath: string,
  options?: { silent?: boolean; stream?: LogStream },
): Promise<void> {
  const stream = options?.stream ?? "both";
  const trackOut = stream === "out" || stream === "both";
  const trackErr = stream === "err" || stream === "both";

  let lastOutLines = 0;
  let lastErrLines = 0;

  if (!options?.silent) {
    const label =
      stream === "both"
        ? `stdout + stderr`
        : stream === "out"
          ? "stdout"
          : "stderr";
    console.log(theme.muted(`\n  Tailing ${label}...`));
    if (stream === "both") {
      console.log(theme.muted(`  (stderr shown in ${theme.error("red")})\n`));
    } else {
      console.log();
    }
  }

  while (true) {
    const jobs = await slurm.getJobs();
    const job = jobs.find((j) => j.id === jobId);

    // Batch-query line counts for tracked files in a single SSH call
    const countCmds: string[] = [];
    if (trackOut) countCmds.push(`wc -l < ${outPath} 2>/dev/null || echo 0`);
    if (trackErr) countCmds.push(`wc -l < ${errPath} 2>/dev/null || echo 0`);

    const countResults = await slurm.sshClient
      .execBatch(countCmds)
      .catch(() => countCmds.map(() => "0"));

    let idx = 0;
    const outTotal = trackOut ? parseInt(countResults[idx++] ?? "0", 10) : 0;
    const errTotal = trackErr ? parseInt(countResults[idx++] ?? "0", 10) : 0;

    // Fetch new lines from whichever files have them (batchable)
    const readCmds: Array<{ type: "out" | "err"; cmd: string }> = [];
    if (trackOut && outTotal > lastOutLines) {
      readCmds.push({
        type: "out",
        cmd: `tail -n +${lastOutLines + 1} ${outPath} 2>/dev/null | head -n ${outTotal - lastOutLines}`,
      });
    }
    if (trackErr && errTotal > lastErrLines) {
      readCmds.push({
        type: "err",
        cmd: `tail -n +${lastErrLines + 1} ${errPath} 2>/dev/null | head -n ${errTotal - lastErrLines}`,
      });
    }

    if (readCmds.length > 0) {
      const readResults = await slurm.sshClient
        .execBatch(readCmds.map((r) => r.cmd))
        .catch(() => readCmds.map(() => ""));

      for (let i = 0; i < readCmds.length; i++) {
        const content = readResults[i];
        if (!content) continue;

        if (readCmds[i]!.type === "err") {
          // Print stderr lines in red
          for (const line of content.split("\n")) {
            if (line) process.stderr.write(theme.error(line) + "\n");
          }
        } else {
          process.stdout.write(content + "\n");
        }
      }
    }

    if (trackOut) lastOutLines = outTotal;
    if (trackErr) lastErrLines = errTotal;

    if (!job || TERMINAL_STATES.has(job.state)) {
      if (!options?.silent) {
        // squeue may no longer have the job — ask scontrol for the real state
        let finalState = job?.state;
        if (
          !finalState ||
          finalState === "COMPLETING" ||
          finalState === "UNKNOWN"
        ) {
          const info = await slurm.getJobState(jobId);
          if (info) {
            // COMPLETING is a transitional state — resolve to COMPLETED or FAILED
            if (info.state === "COMPLETING") {
              finalState = info.exitCode ? "FAILED" : "COMPLETED";
            } else {
              finalState = (info.state as typeof finalState) ?? "COMPLETED";
            }
          } else {
            finalState = "COMPLETED";
          }
        }
        const stateColor =
          finalState === "COMPLETED" ? theme.success : theme.error;
        console.log(
          theme.muted(`\n  Job ${jobId} finished (`) +
            stateColor(finalState) +
            theme.muted(")."),
        );
      }
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
