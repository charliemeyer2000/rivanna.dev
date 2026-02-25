import type { Command } from "commander";
import ora from "ora";
import type { UserRequest, StrategySubmission } from "@rivanna/shared";
import {
  allocate,
  submitStrategies,
  monitorAllocation,
  verifyAllocation,
  getTopologyWarnings,
} from "@/core/allocator.ts";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import { NOTIFY_URL } from "@/lib/constants.ts";
import { addGpuOptions, parseGpuOptions, parseMem } from "@/lib/gpu-options.ts";
import { getAllEnvVars } from "@/core/env-store.ts";
import { generateJobName } from "@/core/job-naming.ts";
import { saveRequest } from "@/core/request-store.ts";

interface UpOptions {
  gpu: string;
  type?: string;
  time: string;
  name?: string;
  mem?: string;
  mig?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export function registerUpCommand(program: Command) {
  const cmd = program.command("up").description("Allocate GPUs on Rivanna");

  addGpuOptions(cmd)
    .option("--dry-run", "show strategies without submitting")
    .option("--json", "output as JSON")
    .action(async (options: UpOptions) => {
      try {
        await runUp(options);
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

async function runUp(options: UpOptions) {
  const { config, slurm } = ensureSetup();
  const isJson = !!options.json;

  // Parse options
  const { gpuCount, gpuType, time } = parseGpuOptions(options);

  const jobName = options.name ?? generateJobName(undefined);

  const request: UserRequest = {
    gpuCount,
    gpuType,
    totalTimeSeconds: time.seconds,
    totalTime: time.formatted,
    jobName,
    account: config.defaults.account,
    user: config.connection.user,
    mem: options.mem ? parseMem(options.mem) : undefined,
    notifyUrl: config.notifications.enabled ? NOTIFY_URL : undefined,
    sharedHfCache: config.shared?.hf_cache,
  };

  // --- Allocate ---
  const spinner = isJson ? null : ora("Probing cluster...").start();
  const result = await allocate(slurm, request);
  spinner?.stop();

  if (result.strategies.length === 0) {
    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(
        theme.error(
          "\nNo viable strategies found. Try a different GPU count, type, or time.",
        ),
      );
      console.error(
        theme.muted(
          `  Compatible GPUs: ${result.compatibleGPUs.join(", ") || "none"}`,
        ),
      );
    }
    process.exit(1);
  }

  // --- Dry run ---
  if (options.dryRun) {
    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printStrategies(result.strategies, result.backfillProbes);
    }
    return;
  }

  // --- Submit ---
  const types = [...new Set(result.strategies.map((s) => s.gpuType))];
  if (!isJson) {
    console.log(
      theme.info(
        `\nSubmitting ${result.strategies.length} strategies across ${types.map((t) => t.toUpperCase()).join(", ")}...`,
      ),
    );
  }

  const envVars = getAllEnvVars();
  const submissions = await submitStrategies(
    slurm,
    result.strategies,
    request,
    envVars,
  );
  if (submissions.length === 0) {
    throw new Error("All strategy submissions failed.");
  }

  saveRequest({
    id: crypto.randomUUID(),
    jobName: request.jobName,
    command: null,
    type: "up",
    strategies: submissions.map((s) => ({
      jobId: s.jobId,
      gpuType: s.strategy.gpuType,
      gpusPerNode: s.strategy.gpusPerNode,
      nodes: s.strategy.nodes,
      topology: s.strategy.topology,
    })),
    createdAt: new Date().toISOString(),
  });

  // --- Monitor ---
  const monitorSpinner = isJson
    ? null
    : ora("Waiting for allocation...").start();
  const startMs = Date.now();

  const outcome = await monitorAllocation(slurm, submissions, {
    onUpdate: (subs: StrategySubmission[]) => {
      if (!monitorSpinner) return;
      const pending = subs.filter(
        (s) => s.state === "PENDING" || s.state === "CONFIGURING",
      ).length;
      const running = subs.filter(
        (s) => s.state === "RUNNING" || s.state === "COMPLETING",
      ).length;
      const elapsed = Math.round((Date.now() - startMs) / 1000);
      monitorSpinner.text = `Waiting... ${pending} pending, ${running} running (${elapsed}s)`;
    },
  });

  monitorSpinner?.stop();

  // Verify actual GPU hardware on the allocated node
  await verifyAllocation(slurm, outcome);

  const winner = outcome.winner;
  const node = winner.nodes[0] ?? "unknown";
  const allocMs = outcome.allocationTimeMs;
  const gpuLabel = outcome.actualGPU
    ? `${outcome.actualGPU.count}x ${outcome.actualGPU.type}`
    : `${winner.strategy.gpusPerNode * winner.strategy.nodes}x ${winner.strategy.gpuType.toUpperCase()}`;

  if (isJson) {
    console.log(JSON.stringify(outcome, null, 2));
    return;
  }

  console.log(
    theme.success(
      `\n✓ Allocated! ${gpuLabel} on ${node} (${(allocMs / 1000).toFixed(1)}s)`,
    ),
  );
  if (outcome.actualGPU?.mismatch) {
    console.log(
      theme.warning(
        `  ⚠ GPU mismatch: requested ${winner.strategy.gpuType.toUpperCase()} but got ${outcome.actualGPU.type}`,
      ),
    );
  }
  const topoWarnings = getTopologyWarnings(winner.strategy);
  for (const w of topoWarnings) {
    console.log(theme.warning(`  ⚠ ${w}`));
  }

  // --- Attach interactive shell ---
  const user = config.connection.user;
  const ckptDir = `/scratch/${user}/.rv/checkpoints/${request.jobName}-${winner.jobId}`;
  const hfHome =
    config.shared?.hf_cache ?? `/scratch/${user}/.cache/huggingface`;
  const envExports = [
    `RV_CHECKPOINT_DIR=${ckptDir}`,
    `HF_HOME=${hfHome}`,
    `UV_CACHE_DIR=/scratch/${user}/.cache/uv`,
    `PIP_CACHE_DIR=/scratch/${user}/.cache/pip`,
  ].join(",");

  console.log(theme.muted(`  Job ID: ${winner.jobId}`));
  console.log(theme.muted(`  Strategy: ${winner.strategy.label}`));
  console.log();

  const exitCode = await slurm.sshClient.execInteractive([
    "ssh",
    "-t",
    config.connection.host,
    `srun --jobid=${winner.jobId} --overlap --export=ALL,${envExports} --pty /bin/bash`,
  ]);
  process.exit(exitCode);
}

function printStrategies(
  strategies: import("@rivanna/shared").Strategy[],
  probes: import("@rivanna/shared").BackfillProbe[],
) {
  if (probes.length > 0) {
    console.log(theme.info("\nBackfill windows:"));
    for (const probe of probes) {
      const mins = Math.round(probe.maxBackfillSeconds / 60);
      const status = probe.fullyBackfillable
        ? theme.success("fully backfillable")
        : mins > 0
          ? theme.accent(`${mins}m ceiling`)
          : theme.muted("no backfill");
      console.log(`  ${probe.gpuType.toUpperCase().padEnd(10)} ${status}`);
    }
  }

  console.log(theme.info(`\nStrategies (${strategies.length}):`));
  for (let i = 0; i < strategies.length; i++) {
    const s = strategies[i]!;
    const wait =
      s.estimatedWaitSeconds < 60
        ? `~${s.estimatedWaitSeconds.toFixed(0)}s`
        : `~${(s.estimatedWaitSeconds / 60).toFixed(0)}m`;
    const su =
      s.estimatedSU > 0
        ? `${Math.round(s.estimatedSU).toLocaleString()} SU`
        : "FREE";
    const bf = s.backfillEligible ? theme.success("✓ backfill") : "";
    console.log(
      `  ${theme.muted(`#${i + 1}`)}  ${s.label.padEnd(50)}  ${wait.padStart(6)}  ${su.padStart(10)}  ${bf}`,
    );
  }
  console.log();
}
