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

interface RunOptions {
  gpu: string;
  type?: string;
  time: string;
  name?: string;
  mem?: string;
  mig?: boolean;
  json?: boolean;
}

export function registerRunCommand(program: Command) {
  program
    .command("run")
    .description("Run a command on Rivanna GPUs")
    .argument("<command...>", "file path or command to run")
    .option("-g, --gpu <n>", "number of GPUs", "1")
    .option("-t, --type <type>", "GPU type")
    .option("--time <duration>", "total time needed", "2:59:00")
    .option("--name <name>", "job name")
    .option(
      "--mem <size>",
      "total CPU memory (e.g., 200G). Auto-calculated if omitted",
    )
    .option("--mig", "shortcut for --gpu 1 --type mig (free)")
    .option("--json", "output as JSON")
    .action(async (commandParts: string[], options: RunOptions) => {
      try {
        await runRun(commandParts, options);
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

async function runRun(commandParts: string[], options: RunOptions) {
  const { config, slurm } = ensureSetup();
  const ssh = slurm.sshClient;
  const isJson = !!options.json;

  let gpuCount = parseInt(options.gpu, 10);
  let gpuType: GPUType | undefined;
  if (options.mig) {
    gpuCount = 1;
    gpuType = "mig";
  } else if (options.type) {
    gpuType = GPU_TYPE_ALIASES[options.type.toLowerCase()];
    if (!gpuType) {
      throw new Error(`Unknown GPU type: "${options.type}"`);
    }
  }

  const time = parseTime(options.time);

  // Smart execution: detect local file → sync → deps → rewrite
  const prepSpinner = isJson ? null : ora("Preparing...").start();
  const execution = await prepareExecution(
    commandParts,
    config.connection.user,
    ssh,
    prepSpinner ?? undefined,
  );
  prepSpinner?.stop();

  const command = execution ? execution.command : commandParts.join(" ");

  // Smart job naming
  let jobName = options.name;
  if (!jobName) {
    jobName = generateJobName(command);
    if (config.defaults.ai_naming && config.defaults.ai_api_key) {
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
    workDir: execution?.workDir,
    venvPath: execution?.venvPath ?? undefined,
    mem: options.mem,
    notifyUrl: config.notifications.enabled ? NOTIFY_URL : undefined,
    sharedHfCache: config.shared?.hf_cache,
  };

  const spinner = isJson ? null : ora("Probing cluster...").start();
  const result = await allocate(slurm, request);
  spinner?.stop();

  if (result.strategies.length === 0) {
    throw new Error("No viable strategies found.");
  }

  const types = [...new Set(result.strategies.map((s) => s.gpuType))];
  if (!isJson) {
    console.log(
      theme.info(
        `Submitting ${result.strategies.length} strategies across ${types.map((t) => t.toUpperCase()).join(", ")}...`,
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

  const monitorSpinner = isJson
    ? null
    : ora("Waiting for allocation...").start();
  const startMs = Date.now();

  const outcome = await monitorAllocation(slurm, submissions, {
    onUpdate: (subs: StrategySubmission[]) => {
      if (!monitorSpinner) return;
      const pending = subs.filter((s) => s.state === "PENDING").length;
      const elapsed = Math.round((Date.now() - startMs) / 1000);
      monitorSpinner.text = `Waiting... ${pending} pending (${elapsed}s)`;
    },
  });

  monitorSpinner?.stop();

  // Verify actual GPU hardware on the allocated node
  await verifyAllocation(slurm, outcome);

  const winner = outcome.winner;
  const node = winner.nodes[0] ?? "unknown";
  const gpuLabel = outcome.actualGPU
    ? `${outcome.actualGPU.count}x ${outcome.actualGPU.type}`
    : `${winner.strategy.gpusPerNode * winner.strategy.nodes}x ${winner.strategy.gpuType.toUpperCase()}`;

  if (isJson) {
    console.log(JSON.stringify(outcome, null, 2));
  } else {
    console.log(theme.success(`✓ Running on ${node} (${gpuLabel})`));
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
  }

  // Tail logs until completion
  const logPath = `/scratch/${config.connection.user}/.rv/logs/${request.jobName}-${winner.jobId}.out`;
  await tailJobLogs(slurm, winner.jobId, logPath, { silent: isJson });

  // Post-job summary with actionable commands
  if (!isJson) {
    console.log(theme.muted("\n  Files on Rivanna:"));
    if (execution?.workDir) {
      console.log(theme.muted(`    Workspace:   ${execution.workDir}`));
    }
    console.log(theme.muted(`    Logs:        ${logPath}`));
    console.log();
    if (execution?.workDir) {
      console.log(theme.muted(`  rv sync pull ${execution.workDir} .`));
    }
    console.log(theme.muted(`  rv logs --pull ${winner.jobId}`));
  }
}
