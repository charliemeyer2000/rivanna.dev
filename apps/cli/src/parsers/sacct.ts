import type { JobAccounting } from "@rivanna/shared";
import { parseTimeToSeconds } from "./squeue.ts";

/**
 * Parse sacct output.
 * Expected format: `sacct --parsable2 -n -o JobID,JobName,State,Elapsed,ExitCode,Partition`
 * Pipe-delimited (`|`), no header (`-n`), no trailing delimiter (`--parsable2`).
 *
 * Sub-job entries (IDs containing `.`) are skipped.
 */
export function parseSacct(output: string): JobAccounting[] {
  const jobs: JobAccounting[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("|");
    if (parts.length < 6) continue;

    const [id, name, state, elapsed, exitCode, partition] = parts;

    // Skip sub-job entries (batch, extern, etc.)
    if (id!.includes(".")) continue;

    jobs.push({
      id: id!,
      name: name!,
      state: state!,
      elapsed: elapsed!,
      elapsedSeconds: parseTimeToSeconds(elapsed!),
      exitCode: exitCode!,
      partition: partition!,
    });
  }

  return jobs;
}
