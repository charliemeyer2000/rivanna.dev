import type { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";

interface PsOptions {
  all?: boolean;
  json?: boolean;
}

export function registerPsCommand(program: Command) {
  program
    .command("ps")
    .description("List your jobs on Rivanna")
    .option("-a, --all", "include completed/failed jobs (last 7 days)")
    .option("--json", "output as JSON")
    .action(async (options: PsOptions) => {
      try {
        await runPs(options);
      } catch (error) {
        if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

async function runPs(options: PsOptions) {
  const { slurm } = ensureSetup();
  const isJson = !!options.json;

  const spinner = isJson ? null : ora("Fetching jobs...").start();

  const jobs = await slurm.getJobs();

  let historyJobs: import("@rivanna/shared").JobAccounting[] = [];
  if (options.all) {
    historyJobs = await slurm.getJobHistory("now-7days");
  }

  spinner?.stop();

  if (isJson) {
    console.log(
      JSON.stringify({ active: jobs, history: historyJobs }, null, 2),
    );
    return;
  }

  if (jobs.length === 0 && historyJobs.length === 0) {
    console.log(theme.muted("\nNo jobs found."));
    return;
  }

  // Active jobs
  if (jobs.length > 0) {
    console.log(theme.info("\nActive jobs:"));
    console.log(
      theme.muted(
        `  ${"ID".padEnd(12)}${"Name".padEnd(18)}${"GPUs".padEnd(16)}${"Node".padEnd(18)}${"Status".padEnd(12)}${"Elapsed".padEnd(10)}Limit`,
      ),
    );

    for (const job of jobs) {
      const stateColor =
        job.state === "RUNNING"
          ? chalk.green
          : job.state === "PENDING"
            ? chalk.yellow
            : chalk.red;
      // Strip "gres/gpu:" prefix for cleaner display (e.g. "a100:2")
      const gpus = job.gres.replace(/^gres\/gpu:/, "");
      const node =
        job.nodes.length > 0
          ? job.nodes.join(",")
          : job.reason
            ? `(${job.reason})`
            : "(pending)";
      console.log(
        `  ${job.id.padEnd(12)}${job.name.padEnd(18).slice(0, 17).padEnd(18)}${gpus.padEnd(16)}${node.padEnd(18)}${stateColor(job.state.padEnd(12))}${job.timeElapsed.padEnd(10)}${job.timeLimit}`,
      );
    }
  }

  // History
  if (historyJobs.length > 0) {
    console.log(theme.info("\nRecent history:"));
    console.log(
      theme.muted(
        `  ${"ID".padEnd(12)}${"Name".padEnd(18)}${"Partition".padEnd(16)}${"State".padEnd(14)}${"Elapsed".padEnd(12)}Exit`,
      ),
    );

    for (const job of historyJobs.slice(0, 20)) {
      const stateColor =
        job.state === "COMPLETED"
          ? chalk.green
          : job.state.startsWith("CANCEL")
            ? chalk.yellow
            : chalk.red;
      console.log(
        `  ${job.id.padEnd(12)}${job.name.padEnd(18).slice(0, 17).padEnd(18)}${job.partition.padEnd(16)}${stateColor(job.state.padEnd(14))}${job.elapsed.padEnd(12)}${job.exitCode}`,
      );
    }
  }

  console.log();
}
