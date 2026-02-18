import type { Command } from "commander";
import ora from "ora";
import type { GPUType, UserRequest, StrategySubmission } from "@rivanna/shared";
import {
  allocate,
  submitStrategies,
  monitorAllocation,
} from "@/core/allocator.ts";
import { ensureSetup, parseTime } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import { GPU_TYPE_ALIASES } from "@/lib/constants.ts";
import { getAllEnvVars } from "@/core/env-store.ts";
import { generateJobName, generateAIJobName } from "@/core/job-naming.ts";
import { tailJobLogs } from "@/core/log-tailer.ts";

interface RunOptions {
  gpu: string;
  type?: string;
  time: string;
  name?: string;
  mig?: boolean;
  json?: boolean;
}

export function registerRunCommand(program: Command) {
  program
    .command("run")
    .description("Run a command on Rivanna GPUs")
    .argument("<command>", "command to run")
    .option("-g, --gpu <n>", "number of GPUs", "1")
    .option("-t, --type <type>", "GPU type")
    .option("--time <duration>", "total time needed", "2:59:00")
    .option("--name <name>", "job name")
    .option("--mig", "shortcut for --gpu 1 --type mig (free)")
    .option("--json", "output as JSON")
    .action(async (command: string, options: RunOptions) => {
      try {
        await runRun(command, options);
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

async function runRun(command: string, options: RunOptions) {
  const { config, slurm } = ensureSetup();
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
    notifyToken: config.notifications.token,
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

  const winner = outcome.winner;
  const node = winner.nodes[0] ?? "unknown";

  if (isJson) {
    console.log(JSON.stringify(outcome, null, 2));
  } else {
    console.log(
      theme.success(
        `✓ Running on ${node} (${winner.strategy.gpusPerNode * winner.strategy.nodes}x ${winner.strategy.gpuType.toUpperCase()})`,
      ),
    );
  }

  // Tail logs until completion
  const logPath = `/scratch/${config.connection.user}/.rv/logs/${request.jobName}-${winner.jobId}.out`;
  await tailJobLogs(slurm, winner.jobId, logPath, { silent: isJson });
}
