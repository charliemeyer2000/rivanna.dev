import type { Command } from "commander";
import type { Job } from "@rivanna/shared";
import ora from "ora";
import chalk from "chalk";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import {
  loadRequests,
  buildJobIndex,
  type RequestRecord,
  type StrategyRecord,
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

/** Format a start time as relative "in Xh Ym" or "starts ~HH:MM" */
function formatStartEta(startTime: string | undefined): string {
  if (!startTime) return "";
  const start = new Date(startTime);
  const now = new Date();
  const diffMs = start.getTime() - now.getTime();
  if (diffMs <= 0 || isNaN(diffMs)) return "";

  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 2) return "starting soon";
  if (diffMin < 60) return `starts in ${diffMin}m`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours < 24) {
    return mins > 0 ? `starts in ${hours}h ${mins}m` : `starts in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0
    ? `starts in ${days}d ${remHours}h`
    : `starts in ${days}d`;
}

/** Format a GPU topology label from a strategy record: "A100:4" or "A100:2×2" */
function formatTopology(strat: StrategyRecord): string {
  // Strip _80/_40 suffixes for display: "a100_80" → "A100"
  const gpu = strat.gpuType.replace(/_\d+$/, "").toUpperCase();
  if (strat.nodes > 1) {
    return `${gpu}:${strat.gpusPerNode}×${strat.nodes}`;
  }
  return `${gpu}:${strat.gpusPerNode * strat.nodes}`;
}

/** Flat row format for orphan jobs (no request metadata). */
function formatJobRow(job: Job): string {
  const stateColor =
    job.state === "RUNNING"
      ? chalk.green
      : job.state === "PENDING"
        ? chalk.yellow
        : chalk.red;
  const gpus = job.gres.replace(/^gres\/gpu:/, "");
  const node =
    job.nodes.length > 0
      ? job.nodes.join(",")
      : job.reason
        ? `(${job.reason})`
        : "(pending)";
  const eta = job.state === "PENDING" ? formatStartEta(job.startTime) : "";
  const etaStr = eta ? `  ${chalk.dim.cyan(eta)}` : "";
  return `  ${job.id.padEnd(12)}${job.name.padEnd(18).slice(0, 17).padEnd(18)}${gpus.padEnd(16)}${node.padEnd(18)}${stateColor(job.state.padEnd(12))}${job.timeElapsed.padEnd(10)}${job.timeLimit}${etaStr}`;
}

/** Render a grouped request: parent line + strategy sub-lines. */
function renderRequestGroup(request: RequestRecord, jobs: Job[]): void {
  // Build strategy lookup
  const stratIndex = new Map<string, StrategyRecord>();
  for (const s of request.strategies) {
    stratIndex.set(s.jobId, s);
  }

  // Determine aggregate state from active jobs
  const activeJob = jobs.find(
    (j) =>
      j.state === "RUNNING" ||
      j.state === "CONFIGURING" ||
      j.state === "COMPLETING",
  );
  const aggregateState = activeJob ? activeJob.state : jobs[0]!.state;
  const representative = activeJob ?? jobs[0]!;

  const stateColor =
    aggregateState === "RUNNING" ||
    aggregateState === "CONFIGURING" ||
    aggregateState === "COMPLETING"
      ? chalk.green
      : aggregateState === "PENDING"
        ? chalk.yellow
        : chalk.red;

  // Build parent line: name + command + state + elapsed + limit
  const termWidth = process.stdout.columns ?? 100;
  const name = request.jobName.slice(0, 20).padEnd(21);
  const stateStr = stateColor(aggregateState.padEnd(10));
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

  console.log(`  ${name}${cmdStr}${stateStr}${elapsed}${limit}`);

  // Sub-lines: one per active job
  for (const job of jobs) {
    const strat = stratIndex.get(job.id);
    const topo = strat
      ? formatTopology(strat)
      : job.gres.replace(/^gres\/gpu:/, "");
    const node =
      job.nodes.length > 0
        ? job.nodes.join(",")
        : job.reason
          ? `(${job.reason})`
          : "";
    // Show estimated start time for PENDING jobs
    const eta = job.state === "PENDING" ? formatStartEta(job.startTime) : "";
    const etaStr = eta ? `  ${chalk.dim.cyan(eta)}` : "";
    console.log(
      theme.muted(`    ${job.id}  ${topo.padEnd(12)}${node}`) + etaStr,
    );
  }
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

    // Orphan jobs in flat format
    if (orphans.length > 0) {
      if (grouped.size > 0) {
        console.log(); // visual separator
      }
      console.log(
        theme.muted(
          `  ${"ID".padEnd(12)}${"Name".padEnd(18)}${"GPUs".padEnd(16)}${"Node".padEnd(18)}${"Status".padEnd(12)}${"Elapsed".padEnd(10)}Limit`,
        ),
      );
      for (const job of orphans) {
        console.log(formatJobRow(job));
      }
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
