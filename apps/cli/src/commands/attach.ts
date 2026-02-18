import type { Command } from "commander";
import ora from "ora";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";

export function registerAttachCommand(program: Command) {
  program
    .command("attach")
    .description("Attach to a running job on Rivanna")
    .argument("[jobId]", "job to attach to (default: most recent running)")
    .action(async (jobId: string | undefined) => {
      try {
        await runAttach(jobId);
      } catch (error) {
        if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

async function runAttach(jobId: string | undefined) {
  const { config, slurm } = ensureSetup();

  let targetJobId = jobId;

  if (!targetJobId) {
    const spinner = ora("Finding running jobs...").start();
    const jobs = await slurm.getJobs();
    spinner.stop();

    const running = jobs.filter((j) => j.state === "RUNNING");
    if (running.length === 0) {
      console.error(theme.error("\nNo running jobs to attach to."));
      const pending = jobs.filter((j) => j.state === "PENDING");
      if (pending.length > 0) {
        console.error(
          theme.muted(
            `  ${pending.length} job(s) pending. Wait for allocation.`,
          ),
        );
      }
      process.exit(1);
    }

    // Use the most recent (highest ID) running job
    targetJobId = running.sort((a, b) => parseInt(b.id) - parseInt(a.id))[0]!
      .id;
    console.log(theme.muted(`Attaching to job ${targetJobId}...`));
  }

  const exitCode = await slurm.sshClient.execInteractive([
    "ssh",
    "-t",
    config.connection.host,
    `srun --jobid=${targetJobId} --overlap --pty /bin/bash`,
  ]);
  process.exit(exitCode);
}
