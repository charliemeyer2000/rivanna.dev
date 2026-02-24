import type { Command } from "commander";
import ora from "ora";
import { confirm } from "@inquirer/prompts";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import {
  loadRequests,
  buildJobIndex,
  reapLosers,
} from "@/core/request-store.ts";

interface StopOptions {
  all?: boolean;
}

export function registerStopCommand(program: Command) {
  program
    .command("stop")
    .alias("cancel")
    .description("Cancel jobs on Rivanna")
    .argument("[jobIdOrName]", "job ID or job name to cancel")
    .option("-a, --all", "cancel all your jobs")
    .action(async (jobIdOrName: string | undefined, options: StopOptions) => {
      try {
        await runStop(jobIdOrName, options);
      } catch (error) {
        if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

async function runStop(jobIdOrName: string | undefined, options: StopOptions) {
  const { slurm } = ensureSetup();

  if (options.all) {
    const spinner = ora("Fetching jobs...").start();
    const jobs = await slurm.getJobs();
    spinner.stop();

    // Opportunistic fan-out cleanup
    reapLosers(slurm, jobs).catch(() => {});

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

  if (jobIdOrName) {
    // Try to find the request group for this job (by ID or name)
    const requests = loadRequests();
    const isNumeric = /^\d+$/.test(jobIdOrName);

    let siblingIds: string[] | null = null;
    let groupName: string | null = null;

    if (isNumeric) {
      // Lookup by job ID
      const jobIndex = buildJobIndex(requests);
      const parentReq = jobIndex.get(jobIdOrName);
      if (parentReq && parentReq.strategies.length > 1) {
        siblingIds = parentReq.strategies.map((s) => s.jobId);
        groupName = parentReq.jobName;
      }
    } else {
      // Lookup by job name — find the most recent matching request
      const matching = requests
        .filter((r) => r.jobName === jobIdOrName)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      if (matching.length > 0) {
        const req = matching[0]!;
        siblingIds = req.strategies.map((s) => s.jobId);
        groupName = req.jobName;
      }
    }

    // If this job is part of a strategy group, offer to cancel all
    if (siblingIds && siblingIds.length > 1 && groupName) {
      console.log(
        theme.muted(
          `  "${groupName}" has ${siblingIds.length} strategies: ${siblingIds.join(", ")}`,
        ),
      );

      const cancelAll = await confirm({
        message: `Cancel all ${siblingIds.length} strategies?`,
        default: true,
      });

      if (cancelAll) {
        const spinner = ora(
          `Cancelling ${siblingIds.length} strategies...`,
        ).start();
        await slurm.cancelJobs(siblingIds);
        spinner.succeed(
          `Cancelled ${siblingIds.length} strategies for "${groupName}".`,
        );
        return;
      }

      // User declined — cancel just the one they specified (if it's a job ID)
      if (isNumeric) {
        const spinner = ora(`Cancelling job ${jobIdOrName}...`).start();
        await slurm.cancelJob(jobIdOrName);
        spinner.succeed(`Cancelled job ${jobIdOrName}.`);
        return;
      }
      console.log(theme.muted("Cancelled."));
      return;
    }

    // Name lookup with single strategy, or no request-store match
    if (!isNumeric && siblingIds) {
      // Name matched a single-strategy request
      const id = siblingIds[0]!;
      const spinner = ora(`Cancelling job ${id}...`).start();
      await slurm.cancelJob(id);
      spinner.succeed(`Cancelled job ${id} ("${groupName}").`);
      return;
    }

    if (!isNumeric && !siblingIds) {
      console.error(
        theme.error(
          `No job found with name "${jobIdOrName}". Use a numeric job ID or check rv ps.`,
        ),
      );
      process.exit(1);
    }

    // Orphan job ID (not in request store) — cancel directly
    const spinner = ora(`Cancelling job ${jobIdOrName}...`).start();
    await slurm.cancelJob(jobIdOrName);
    spinner.succeed(`Cancelled job ${jobIdOrName}.`);
    return;
  }

  console.error(
    theme.error(
      'Specify a job ID or name, or use --all. See "rv stop --help".',
    ),
  );
  process.exit(1);
}
