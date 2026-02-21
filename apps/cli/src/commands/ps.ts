import type { Command } from "commander";
import type { Job } from "@rivanna/shared";
import ora from "ora";
import chalk from "chalk";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import { renderTable, renderInteractiveTable } from "@/lib/table.ts";
import {
  stateColor,
  formatStartEta,
  buildStrategyIndex,
  renderStrategySubLines,
  formatOrphanJobRow,
  ORPHAN_JOB_HEADERS,
} from "@/lib/format-jobs.ts";
import {
  loadRequests,
  buildJobIndex,
  type RequestRecord,
} from "@/core/request-store.ts";

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

/** Render a grouped request: parent line + strategy sub-lines. */
function renderRequestGroup(request: RequestRecord, jobs: Job[]): void {
  const stratIndex = buildStrategyIndex(request.strategies);

  // Determine aggregate state from active jobs
  const activeJob = jobs.find(
    (j) =>
      j.state === "RUNNING" ||
      j.state === "CONFIGURING" ||
      j.state === "COMPLETING",
  );
  const aggregateState = activeJob ? activeJob.state : jobs[0]!.state;
  const representative = activeJob ?? jobs[0]!;
  const colorFn = stateColor(aggregateState);

  // Build branch tag from git metadata
  let branchTag = "";
  if (request.git) {
    const dirtyMark = request.git.dirty ? "*" : "";
    branchTag = chalk.cyan(
      ` [${request.git.branch}@${request.git.commitHash}${dirtyMark}]`,
    );
  }

  // Build parent line: name + command + state + elapsed + limit
  const termWidth = process.stdout.columns ?? 100;
  const name = request.jobName.slice(0, 20).padEnd(21);
  const stateStr = colorFn(aggregateState.padEnd(10));
  const elapsed = representative.timeElapsed.padEnd(8);
  const limit = representative.timeLimit;

  // Truncate command to fit remaining width
  // Layout: 2 indent + 21 name + cmd + 10 state + 8 elapsed + 7 limit = ~48 fixed
  const fixedWidth = 2 + 21 + 10 + 8 + 7;
  const maxCmdLen = Math.max(termWidth - fixedWidth, 10);
  let cmdStr = "";
  if (request.command) {
    const cmd =
      request.command.length > maxCmdLen
        ? request.command.slice(0, maxCmdLen - 1) + "\u2026"
        : request.command;
    cmdStr = chalk.dim(cmd.padEnd(maxCmdLen));
  } else {
    cmdStr = " ".repeat(maxCmdLen);
  }

  console.log(`  ${name}${cmdStr}${stateStr}${elapsed}${limit}${branchTag}`);

  // Sub-lines: one per active job
  renderStrategySubLines(jobs, stratIndex);
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

  // Load request store for grouping
  const requests = loadRequests();
  const jobIndex = buildJobIndex(requests);

  if (isJson) {
    const enrichedJobs = jobs.map((j) => {
      const req = jobIndex.get(j.id);
      return req ? { ...j, requestId: req.id, requestCommand: req.command } : j;
    });
    console.log(
      JSON.stringify({ active: enrichedJobs, history: historyJobs }, null, 2),
    );
    return;
  }

  if (jobs.length === 0 && historyJobs.length === 0) {
    console.log(theme.muted("\nNo jobs found."));
    return;
  }

  // Active jobs — group by request, orphans fall through to flat display
  if (jobs.length > 0) {
    console.log(theme.info("\nActive jobs:"));

    // Bucket jobs by request ID
    const grouped = new Map<string, { request: RequestRecord; jobs: Job[] }>();
    const orphans: Job[] = [];

    for (const job of jobs) {
      const req = jobIndex.get(job.id);
      if (req) {
        let bucket = grouped.get(req.id);
        if (!bucket) {
          bucket = { request: req, jobs: [] };
          grouped.set(req.id, bucket);
        }
        bucket.jobs.push(job);
      } else {
        orphans.push(job);
      }
    }

    for (const [, { request, jobs: reqJobs }] of grouped) {
      renderRequestGroup(request, reqJobs);
    }

    // Orphan jobs in flat table format
    if (orphans.length > 0) {
      if (grouped.size > 0) {
        console.log(); // visual separator
      }
      renderTable({
        headers: ORPHAN_JOB_HEADERS,
        rows: orphans.map(formatOrphanJobRow),
      });
    }
  }

  // History — paginated when many jobs
  if (historyJobs.length > 0) {
    console.log(theme.info("\nRecent history:"));

    const historyRows = historyJobs.map((job) => {
      const colorFn = stateColor(job.state);
      return [
        job.id,
        job.name.slice(0, 17),
        job.partition,
        colorFn(job.state),
        job.elapsed,
        job.exitCode,
      ];
    });

    await renderInteractiveTable({
      headers: ["ID", "Name", "Partition", "State", "Elapsed", "Exit"],
      rows: historyRows,
    });
  }

  console.log();
}
