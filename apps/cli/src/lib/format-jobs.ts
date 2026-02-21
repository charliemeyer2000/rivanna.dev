import chalk from "chalk";
import type { Job } from "@rivanna/shared";
import type { StrategyRecord } from "@/core/request-store.ts";
import { theme } from "./theme.ts";

/** Format seconds into a human-readable duration like "2m 30s", "1h 5m", "2d 3h". */
export function formatHumanTime(seconds: number): string {
  if (seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/** Color a job state string consistently across all commands. */
export function stateColor(state: string): (s: string) => string {
  if (state === "RUNNING" || state === "CONFIGURING" || state === "COMPLETING")
    return chalk.green;
  if (state === "PENDING") return chalk.yellow;
  if (state === "COMPLETED") return chalk.green;
  if (state.startsWith("CANCEL")) return chalk.yellow;
  return chalk.red;
}

/** Format a GPU topology label: "A100:4" or "A100:2x2". */
export function formatTopology(strat: StrategyRecord): string {
  const gpu = strat.gpuType.replace(/_\d+$/, "").toUpperCase();
  if (strat.nodes > 1) {
    return `${gpu}:${strat.gpusPerNode}\u00d7${strat.nodes}`;
  }
  return `${gpu}:${strat.gpusPerNode * strat.nodes}`;
}

/** Format a start time as relative "starts in Xh Ym". */
export function formatStartEta(startTime: string | undefined): string {
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

/**
 * Render strategy sub-lines for a grouped request (shared by ps and status).
 * Each line shows: job ID, topology, node, and ETA for pending jobs.
 */
export function renderStrategySubLines(
  jobs: Job[],
  stratIndex: Map<string, StrategyRecord>,
): void {
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
    const eta = job.state === "PENDING" ? formatStartEta(job.startTime) : "";
    const etaStr = eta ? `  ${chalk.dim.cyan(eta)}` : "";
    console.log(
      theme.muted(`    ${job.id}  ${topo.padEnd(12)}${node}`) + etaStr,
    );
  }
}

/** Build a strategy lookup map from a request's strategies. */
export function buildStrategyIndex(
  strategies: StrategyRecord[],
): Map<string, StrategyRecord> {
  const index = new Map<string, StrategyRecord>();
  for (const s of strategies) {
    index.set(s.jobId, s);
  }
  return index;
}

/**
 * Format an orphan job (no request metadata) as a table row.
 * Returns a string[] suitable for renderTable/renderInteractiveTable.
 * Columns: ID, Name, GPUs, Node, State, Elapsed, Limit
 */
export function formatOrphanJobRow(job: Job): string[] {
  const gpus = job.gres.replace(/^gres\/gpu:/, "");
  const node =
    job.nodes.length > 0
      ? job.nodes.join(",")
      : job.reason
        ? `(${job.reason})`
        : "(pending)";
  const eta = job.state === "PENDING" ? formatStartEta(job.startTime) : "";
  const etaStr = eta ? `  ${chalk.dim.cyan(eta)}` : "";
  return [
    job.id,
    job.name.slice(0, 17),
    gpus,
    node + etaStr,
    stateColor(job.state)(job.state),
    formatHumanTime(job.timeElapsedSeconds),
    formatHumanTime(job.timeLimitSeconds),
  ];
}

/** Header labels matching formatOrphanJobRow columns. */
export const ORPHAN_JOB_HEADERS = [
  "ID",
  "Name",
  "GPUs",
  "Node",
  "Status",
  "Elapsed",
  "Limit",
];
