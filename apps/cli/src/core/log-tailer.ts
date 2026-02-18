import type { SlurmClient } from "./slurm.ts";
import { theme } from "@/lib/theme.ts";

/**
 * Tail a job's log file, printing new lines as they appear.
 * Polls every 3 seconds until the job finishes.
 */
export async function tailJobLogs(
  slurm: SlurmClient,
  jobId: string,
  logPath: string,
  options?: { silent?: boolean },
): Promise<void> {
  let lastLineCount = 0;

  if (!options?.silent) {
    console.log(theme.muted(`\n  Tailing ${logPath}...\n`));
  }

  while (true) {
    const jobs = await slurm.getJobs();
    const job = jobs.find((j) => j.id === jobId);

    const output = await slurm.sshClient
      .exec(`wc -l < ${logPath} 2>/dev/null || echo 0`)
      .catch(() => "0");
    const totalLines = parseInt(output, 10);

    if (totalLines > lastLineCount) {
      const newLines = await slurm.sshClient
        .exec(
          `tail -n +${lastLineCount + 1} ${logPath} 2>/dev/null | head -n ${totalLines - lastLineCount}`,
        )
        .catch(() => "");
      if (newLines) {
        process.stdout.write(newLines + "\n");
      }
      lastLineCount = totalLines;
    }

    if (!job || (job.state !== "RUNNING" && job.state !== "PENDING")) {
      if (!options?.silent) {
        console.log(
          theme.muted(
            `\n  Job ${jobId} finished (${job?.state ?? "COMPLETED"}).`,
          ),
        );
      }
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
