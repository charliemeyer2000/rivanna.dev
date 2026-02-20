import type { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import type {
  NodeState,
  GPUType,
  GPUAvailabilitySummary,
} from "@rivanna/shared";
import { GPU_SPECS } from "@rivanna/shared";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import { SQUEUE_FORMAT, SINFO_FORMAT } from "@/lib/constants.ts";
import { parseSqueue } from "@/parsers/squeue.ts";
import { parseSinfo } from "@/parsers/sinfo.ts";
import { parseAllocations } from "@/parsers/allocations.ts";
import { parseHdquota } from "@/parsers/hdquota.ts";
import { cleanStaleForwards } from "@/core/forward-store.ts";
import {
  loadRequests,
  buildJobIndex,
  type RequestRecord,
  type StrategyRecord,
} from "@/core/request-store.ts";
import { VPNError, SSHConnectionError, SSHTimeoutError } from "@/lib/errors.ts";

interface StatusOptions {
  json?: boolean;
}

export function registerStatusCommand(program: Command) {
  program
    .command("status")
    .description("Dashboard showing cluster status")
    .option("--json", "output as JSON")
    .action(async (options: StatusOptions) => {
      try {
        await runStatus(options);
      } catch (error) {
        if (options.json) {
          console.log(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        } else if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

function summarizeGPUAvailability(
  nodes: NodeState[],
): GPUAvailabilitySummary[] {
  const byType = new Map<
    string,
    { total: number; available: number; partition: string }
  >();

  for (const node of nodes) {
    const key = node.gresType;
    if (!key || key === "none") continue;

    const existing = byType.get(key) ?? {
      total: 0,
      available: 0,
      partition: node.partition,
    };
    existing.total += node.gpuTotal;
    existing.available += node.gpuAvailable;
    byType.set(key, existing);
  }

  const summaries: GPUAvailabilitySummary[] = [];

  // Map gresType to GPUType
  const gresTypeMap: Record<string, GPUType> = {
    "1g.10gb": "mig",
    rtx3090: "rtx3090",
    a6000: "a6000",
    a40: "a40",
    a100: "a100_80", // Default to 80GB
    v100: "v100",
    h200: "h200",
  };

  for (const [gresType, data] of byType) {
    const gpuType = gresTypeMap[gresType];
    if (!gpuType) continue;

    const spec = GPU_SPECS[gpuType];
    const used = data.total - data.available;
    summaries.push({
      gpuType,
      partition: data.partition,
      totalGPUs: data.total,
      availableGPUs: data.available,
      utilizationPercent:
        data.total > 0 ? Math.round((used / data.total) * 100) : 0,
      suPerGPUHour: spec.suPerGPUHour,
    });
  }

  return summaries.sort((a, b) => a.suPerGPUHour - b.suPerGPUHour);
}

/** Format a start time as relative "starts in Xh Ym" */
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

/** Format a GPU topology label from a strategy record */
function formatTopology(strat: StrategyRecord): string {
  const gpu = strat.gpuType.replace(/_\d+$/, "").toUpperCase();
  if (strat.nodes > 1) {
    return `${gpu}:${strat.gpusPerNode}×${strat.nodes}`;
  }
  return `${gpu}:${strat.gpusPerNode * strat.nodes}`;
}

/** Render a grouped request: parent line + strategy sub-lines (compact for status). */
function renderStatusRequestGroup(
  request: RequestRecord,
  jobs: import("@rivanna/shared").Job[],
): void {
  const stratIndex = new Map<string, StrategyRecord>();
  for (const s of request.strategies) {
    stratIndex.set(s.jobId, s);
  }

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

  // Compact parent line for status dashboard
  const name = request.jobName.slice(0, 20).padEnd(21);
  const stateStr = stateColor(aggregateState.padEnd(10));
  const timeStr = `${representative.timeElapsed}/${representative.timeLimit}`;

  console.log(`  ${name}${stateStr}${timeStr}`);

  // Sub-lines: strategy details
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

async function runStatus(options: StatusOptions) {
  const { config, slurm } = ensureSetup();
  const isJson = !!options.json;
  const user = config.connection.user;

  const spinner = isJson ? null : ora("Fetching cluster status...").start();

  // Batched SSH call for all data — handle connectivity failures gracefully
  let batchResults: string[] = [];
  try {
    batchResults = await slurm.sshClient.execBatch([
      "allocations 2>/dev/null || true",
      "hdquota 2>/dev/null || true",
      `squeue --all -u ${user} -o "${SQUEUE_FORMAT}" --noheader`,
      `sinfo --Node -p gpu,gpu-mig,interactive-rtx3090,gpu-a6000,gpu-a40,gpu-a100-40,gpu-a100-80,gpu-v100,gpu-h200 -o "${SINFO_FORMAT}" --noheader`,
    ]);
  } catch (error) {
    spinner?.stop();

    const isVpn = error instanceof VPNError || error instanceof SSHTimeoutError;
    const isAuth =
      error instanceof SSHConnectionError &&
      error.message.includes("authentication failed");

    if (isJson) {
      console.log(
        JSON.stringify(
          {
            connection: {
              ok: false,
              host: config.connection.host,
              user,
              error: isVpn
                ? "vpn_disconnected"
                : isAuth
                  ? "auth_failed"
                  : "connection_failed",
            },
          },
          null,
          2,
        ),
      );
    } else {
      if (isVpn) {
        console.log(
          theme.info("\nConnection") +
            `    ${theme.error("DISCONNECTED")} — check UVA VPN (Cisco AnyConnect)`,
        );
      } else if (isAuth) {
        console.log(
          theme.info("\nConnection") +
            `    ${theme.error("AUTH FAILED")} — run ${theme.accent("rv init")} to fix`,
        );
      } else {
        console.log(
          theme.info("\nConnection") +
            `    ${theme.error("FAILED")} — ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
      console.log();
    }
    process.exit(1);
  }

  const suBalance = parseAllocations(batchResults[0] ?? "");
  const storage = parseHdquota(batchResults[1] ?? "");
  const jobs = parseSqueue(batchResults[2] ?? "");
  const nodes = parseSinfo(batchResults[3] ?? "");
  const gpuSummary = summarizeGPUAvailability(nodes);
  const forwards = cleanStaleForwards();

  spinner?.stop();

  if (isJson) {
    console.log(
      JSON.stringify(
        {
          connection: {
            ok: true,
            host: config.connection.host,
            user,
          },
          account: suBalance,
          storage,
          activeJobs: jobs,
          gpuAvailability: gpuSummary,
          activeForwards: forwards,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Connection
  console.log(
    theme.info(`\nConnection`) +
      `    ${theme.success("OK")} (${config.connection.host} as ${user})`,
  );

  // Account
  if (suBalance.accounts.length > 0) {
    const acct = suBalance.accounts[0]!;
    console.log(
      theme.info("Account") +
        `       ${acct.name} | ${Math.round(acct.balanceSU).toLocaleString()} SUs remaining`,
    );
  }

  // Storage
  if (storage.length > 0) {
    console.log(theme.info("\nStorage"));
    for (const s of storage) {
      const usedGB = Math.round(s.usedBytes / 1e9);
      const totalGB = Math.round(s.totalBytes / 1e9);
      const unit = totalGB >= 1000 ? "TB" : "GB";
      const usedDisp = unit === "TB" ? (usedGB / 1000).toFixed(1) : usedGB;
      const totalDisp = unit === "TB" ? (totalGB / 1000).toFixed(0) : totalGB;
      const pct = s.usedPercent;
      const color =
        pct > 80 ? chalk.red : pct > 60 ? chalk.yellow : chalk.green;
      console.log(
        `  ${s.type.padEnd(12)} ${s.mountPoint.padEnd(28)} ${String(usedDisp).padStart(6)}/${totalDisp} ${unit}  ${color(`${pct}%`)}`,
      );
    }
  }

  // Active jobs — grouped by request (same format as `rv ps`)
  if (jobs.length > 0) {
    console.log(theme.info("\nActive Jobs"));

    const requests = loadRequests();
    const jobIndex = buildJobIndex(requests);

    // Bucket jobs by request ID
    const grouped = new Map<
      string,
      { request: RequestRecord; jobs: import("@rivanna/shared").Job[] }
    >();
    const orphans: import("@rivanna/shared").Job[] = [];

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
      renderStatusRequestGroup(request, reqJobs);
    }

    // Orphan jobs in flat format
    for (const job of orphans) {
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
            : "";
      const eta = job.state === "PENDING" ? formatStartEta(job.startTime) : "";
      const etaStr = eta ? `  ${chalk.dim.cyan(eta)}` : "";
      console.log(
        `  ${job.id.padEnd(12)}${job.name.padEnd(20).slice(0, 19).padEnd(20)}${gpus.padEnd(14)}${node.padEnd(16)}${stateColor(job.state.padEnd(10))}${job.timeElapsed}/${job.timeLimit}${etaStr}`,
      );
    }
  } else {
    console.log(theme.muted("\nNo active jobs."));
  }

  // Port forwards
  if (forwards.length > 0) {
    console.log(theme.info("\nPort Forwards"));
    for (const fwd of forwards) {
      console.log(
        `  localhost:${fwd.localPort} ${theme.muted("→")} ${fwd.node}:${fwd.remotePort} ${theme.muted(`(job ${fwd.jobId}, PID ${fwd.pid})`)}`,
      );
    }
  }

  // GPU availability
  if (gpuSummary.length > 0) {
    console.log(theme.info("\nGPU Availability"));
    console.log(
      theme.muted(
        `  ${"Type".padEnd(12)}${"Total".padEnd(10)}${"Avail".padEnd(10)}${"Used".padEnd(8)}SU/hr`,
      ),
    );
    for (const g of gpuSummary) {
      const label = g.gpuType === "mig" ? "MIG" : g.gpuType.toUpperCase();
      const unit = g.gpuType === "mig" ? "slices" : "GPUs";
      const suStr = g.suPerGPUHour === 0 ? "FREE" : g.suPerGPUHour.toFixed(0);
      const pctColor =
        g.utilizationPercent > 90
          ? chalk.red
          : g.utilizationPercent > 70
            ? chalk.yellow
            : chalk.green;
      console.log(
        `  ${label.padEnd(12)}${`${g.totalGPUs} ${unit}`.padEnd(10)}${String(g.availableGPUs).padEnd(10)}${pctColor(`${g.utilizationPercent}%`.padEnd(8))}${suStr}`,
      );
    }
  }

  console.log();
}
