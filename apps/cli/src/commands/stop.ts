import type { Command } from "commander";
import ora from "ora";
import { confirm } from "@inquirer/prompts";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";

interface StopOptions {
  all?: boolean;
}

export function registerStopCommand(program: Command) {
  program
    .command("stop")
    .alias("cancel")
    .description("Cancel jobs on Rivanna")
    .argument("[jobId]", "job ID to cancel")
    .option("-a, --all", "cancel all your jobs")
    .action(async (jobId: string | undefined, options: StopOptions) => {
      try {
        await runStop(jobId, options);
      } catch (error) {
        if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

async function runStop(jobId: string | undefined, options: StopOptions) {
  const { slurm } = ensureSetup();

  if (options.all) {
    const spinner = ora("Fetching jobs...").start();
    const jobs = await slurm.getJobs();
    spinner.stop();

    if (jobs.length === 0) {
      console.log(theme.muted("\nNo active jobs to cancel."));
      return;
    }

    const proceed = await confirm({
      message: `Cancel ${jobs.length} job(s)?`,
      default: false,
    });

    if (!proceed) {
      console.log(theme.muted("Cancelled."));
      return;
    }

    const cancelSpinner = ora(`Cancelling ${jobs.length} jobs...`).start();
    await slurm.cancelJobs(jobs.map((j) => j.id));
    cancelSpinner.succeed(`Cancelled ${jobs.length} jobs.`);
    return;
  }

  if (jobId) {
    const spinner = ora(`Cancelling job ${jobId}...`).start();
    await slurm.cancelJob(jobId);
    spinner.succeed(`Cancelled job ${jobId}.`);
    return;
  }

  console.error(
    theme.error('Specify a job ID or use --all. See "rv stop --help".'),
  );
  process.exit(1);
}
