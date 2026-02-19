import type { Command } from "commander";
import ora from "ora";
import type { GPUType, UserRequest, StrategySubmission } from "@rivanna/shared";
import {
  allocate,
  submitStrategies,
  monitorAllocation,
  verifyAllocation,
  getTopologyWarnings,
} from "@/core/allocator.ts";
import { ensureSetup, parseTime } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import { GPU_TYPE_ALIASES, NOTIFY_URL } from "@/lib/constants.ts";
import { getAllEnvVars } from "@/core/env-store.ts";
import { generateJobName, generateAIJobName } from "@/core/job-naming.ts";
import { tailJobLogs } from "@/core/log-tailer.ts";
import { prepareExecution } from "@/core/project.ts";

interface UpOptions {
  gpu: string;
  type?: string;
  time: string;
  run?: string;
  name?: string;
  mem?: string;
  mig?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export function registerUpCommand(program: Command) {
  program
    .command("up")
    .description("Allocate GPUs on Rivanna")
    .option("-g, --gpu <n>", "number of GPUs", "1")
    .option(
      "-t, --type <type>",
      "GPU type: a100, a6000, a40, h200, v100, rtx3090, mig",
    )
    .option("--time <duration>", "total time needed: 2h, 24h, 3d", "2:59:00")
    .option("--run <command>", "batch mode: run command/file then exit")
    .option("--name <name>", "job name")
    .option(
      "--mem <size>",
      "total CPU memory (e.g., 200G). Auto-calculated if omitted",
    )
    .option("--mig", "shortcut for --gpu 1 --type mig (free, instant)")
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
  const ssh = slurm.sshClient;
  const isJson = !!options.json;

  // Parse options
  let gpuCount = parseInt(options.gpu, 10);
  let gpuType: GPUType | undefined;
  if (options.mig) {
    gpuCount = 1;
    gpuType = "mig";
  } else if (options.type) {
    const alias = GPU_TYPE_ALIASES[options.type.toLowerCase()];
    if (!alias) {
      throw new Error(
        `Unknown GPU type: "${options.type}". Valid: ${Object.keys(GPU_TYPE_ALIASES).join(", ")}`,
      );
    }
    gpuType = alias;
  }

  const time = parseTime(options.time);

  // Smart execution: detect local file in --run, sync, deps
  let command = options.run;
  let workDir: string | undefined;
  let venvPath: string | undefined;

  if (options.run) {
    const parts = options.run.split(/\s+/);
    const prepSpinner = isJson ? null : ora("Preparing...").start();
    const execution = await prepareExecution(
      parts,
      config.connection.user,
      ssh,
      prepSpinner ?? undefined,
    );
    prepSpinner?.stop();

    if (execution) {
      command = execution.command;
      workDir = execution.workDir;
      venvPath = execution.venvPath ?? undefined;
    }
  }

  // Smart job naming
  let jobName = options.name;
  if (!jobName) {
    jobName = generateJobName(command);
    if (config.defaults.ai_naming && config.defaults.ai_api_key && command) {
      const apiKey = config.defaults.ai_api_key;
      const provider = apiKey.startsWith("sk-ant-")
        ? ("anthropic" as const)
        : ("openai" as const);
      const aiName = await generateAIJobName(command, apiKey, provider);
      if (aiName) jobName = `rv-${aiName}`;
    }
  }

  const request: UserRequest = {
    gpuCount,
    gpuType,
    totalTimeSeconds: time.seconds,
    totalTime: time.formatted,
    jobName,
    account: config.defaults.account,
    user: config.connection.user,
    command,
    workDir,
    venvPath,
    mem: options.mem,
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

  // --- Monitor ---
  const monitorSpinner = isJson
    ? null
    : ora("Waiting for allocation...").start();
  const startMs = Date.now();

  const outcome = await monitorAllocation(slurm, submissions, {
    onUpdate: (subs: StrategySubmission[]) => {
      if (!monitorSpinner) return;
      const pending = subs.filter((s) => s.state === "PENDING").length;
      const running = subs.filter((s) => s.state === "RUNNING").length;
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

  // --- Attach or stream logs ---
  if (options.run) {
    const logPath = `/scratch/${config.connection.user}/.rv/logs/${request.jobName}-${winner.jobId}.out`;
    await tailJobLogs(slurm, winner.jobId, logPath);

    // Post-job summary with actionable commands
    const ckptDir = `/scratch/${config.connection.user}/.rv/checkpoints/${request.jobName}-${winner.jobId}`;
    console.log(theme.muted("\n  Files on Rivanna:"));
    if (workDir) {
      console.log(theme.muted(`    Workspace:    ${workDir}`));
    }
    console.log(theme.muted(`    Logs:         ${logPath}`));
    console.log(theme.muted(`    Checkpoints:  ${ckptDir}`));
    console.log();
    if (workDir) {
      console.log(theme.muted(`  rv sync pull ${workDir} .`));
    }
    console.log(theme.muted(`  rv logs --pull ${winner.jobId}`));
  } else {
    // Interactive: attach shell
    console.log(theme.muted(`  Job ID: ${winner.jobId}`));
    console.log(theme.muted(`  Strategy: ${winner.strategy.label}`));
    console.log();

    const exitCode = await slurm.sshClient.execInteractive([
      "ssh",
      "-t",
      config.connection.host,
      `srun --jobid=${winner.jobId} --overlap --pty /bin/bash`,
    ]);
    process.exit(exitCode);
  }
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
