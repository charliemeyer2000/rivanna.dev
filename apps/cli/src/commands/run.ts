import type { Command } from "commander";
import ora from "ora";
import type {
  GPUType,
  RvConfig,
  UserRequest,
  StrategySubmission,
} from "@rivanna/shared";
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
import { prepareExecution, type ExecutionResult } from "@/core/project.ts";
import { lintForMultiNode } from "@/core/preflight.ts";
import { analyzeForHardwareRetry } from "@/core/hardware-retry.ts";
import { shellJoin } from "@/lib/shell-quote.ts";
import { saveRequest } from "@/core/request-store.ts";
import type { SlurmClient } from "@/core/slurm.ts";

interface RunOptions {
  gpu: string;
  type?: string;
  time: string;
  name?: string;
  mem?: string;
  mig?: boolean;
  json?: boolean;
  follow?: boolean;
}

export function registerRunCommand(program: Command) {
  program
    .command("run")
    .description("Run a command on Rivanna GPUs")
    .passThroughOptions()
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
    .option("-f, --follow", "wait for allocation and tail logs")
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

  // Generate job name first (only needs raw command string)
  const rawCommand =
    commandParts.length === 1 ? commandParts[0]! : shellJoin(commandParts);
  let jobName = options.name;
  if (!jobName) {
    jobName = generateJobName(rawCommand);
    if (config.defaults.ai_naming && config.defaults.ai_api_key) {
      const apiKey = config.defaults.ai_api_key;
      const provider = apiKey.startsWith("sk-ant-")
        ? ("anthropic" as const)
        : ("openai" as const);
      const aiName = await generateAIJobName(rawCommand, apiKey, provider);
      if (aiName) jobName = `rv-${aiName}`;
    }
  }

  // Smart execution: detect local file → sync → deps → snapshot → rewrite
  const prepSpinner = isJson ? null : ora("Preparing...").start();
  const execution = await prepareExecution(
    commandParts,
    config.connection.user,
    ssh,
    jobName,
    prepSpinner ?? undefined,
  );
  prepSpinner?.stop();

  // Preflight lint for multi-node submissions
  if (gpuCount >= 4 && execution?.localFilePath && !isJson) {
    const warnings = lintForMultiNode(execution.localFilePath);
    for (const w of warnings) {
      console.log(theme.warning(`  ⚠ Preflight: ${w.message}`));
    }
  }

  const command = execution ? execution.command : rawCommand;

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

  // Allocate + submit
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

  saveRequest({
    id: crypto.randomUUID(),
    jobName: request.jobName,
    command: request.command ?? null,
    type: "run",
    strategies: submissions.map((s) => ({
      jobId: s.jobId,
      gpuType: s.strategy.gpuType,
      gpusPerNode: s.strategy.gpusPerNode,
      nodes: s.strategy.nodes,
      topology: s.strategy.topology,
    })),
    createdAt: new Date().toISOString(),
    ...(execution?.git && {
      git: {
        branch: execution.git.branch,
        commitHash: execution.git.commitHash,
        dirty: execution.git.dirty,
      },
    }),
    ...(execution?.workDir && { snapshotPath: execution.workDir }),
  });

  if (options.follow) {
    await followJob(slurm, config, request, submissions, execution, isJson);
  } else {
    printSubmitted(submissions, execution, isJson);
  }
}

function printSubmitted(
  submissions: StrategySubmission[],
  execution: ExecutionResult | null,
  isJson: boolean,
): void {
  if (isJson) {
    console.log(
      JSON.stringify(
        {
          strategies: submissions.map((s) => ({
            jobId: s.jobId,
            gpuType: s.strategy.gpuType,
            partition: s.strategy.partition,
            topology: s.strategy.topology,
            label: s.strategy.label,
          })),
          ...(execution?.git && { git: execution.git }),
          ...(execution?.workDir && { snapshotPath: execution.workDir }),
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const sub of submissions) {
    console.log(theme.muted(`  ${sub.jobId}  ${sub.strategy.label}`));
  }

  if (execution?.codeDir || execution?.workDir || execution?.git) {
    console.log(theme.muted("\n  Files on Rivanna:"));
    if (execution.codeDir) {
      console.log(theme.muted(`    Workspace:    ${execution.codeDir}`));
    }
    if (execution.workDir) {
      console.log(theme.muted(`    Snapshot:     ${execution.workDir}`));
    }
    if (execution.git) {
      const dirty = execution.git.dirty ? "*" : "";
      console.log(
        theme.muted(
          `    Git:          ${execution.git.branch}@${execution.git.commitHash}${dirty}`,
        ),
      );
    }
  }

  console.log();
  console.log(theme.muted(`  rv ps`));
  console.log(theme.muted(`  rv logs -f ${submissions[0]!.jobId}`));
}

async function followJob(
  slurm: SlurmClient,
  config: RvConfig,
  request: UserRequest,
  initialSubmissions: StrategySubmission[],
  execution: ExecutionResult | null,
  isJson: boolean,
): Promise<void> {
  let submissions = initialSubmissions;
  let retryCount = 0;

  for (;;) {
    // On hardware retry, re-allocate and re-submit
    if (retryCount > 0) {
      const spinner = isJson ? null : ora("Reprobing cluster...").start();
      const result = await allocate(slurm, request);
      spinner?.stop();

      if (result.strategies.length === 0) {
        throw new Error("No viable strategies on retry.");
      }

      const envVars = getAllEnvVars();
      submissions = await submitStrategies(
        slurm,
        result.strategies,
        request,
        envVars,
      );
      if (submissions.length === 0) {
        throw new Error("All retry submissions failed.");
      }

      saveRequest({
        id: crypto.randomUUID(),
        jobName: request.jobName,
        command: request.command ?? null,
        type: "run",
        strategies: submissions.map((s) => ({
          jobId: s.jobId,
          gpuType: s.strategy.gpuType,
          gpusPerNode: s.strategy.gpusPerNode,
          nodes: s.strategy.nodes,
          topology: s.strategy.topology,
        })),
        createdAt: new Date().toISOString(),
        ...(execution?.git && {
          git: {
            branch: execution.git.branch,
            commitHash: execution.git.commitHash,
            dirty: execution.git.dirty,
          },
        }),
        ...(execution?.workDir && { snapshotPath: execution.workDir }),
      });
    }

    const monitorSpinner = isJson
      ? null
      : ora("Waiting for allocation...").start();
    const jobStartMs = Date.now();

    const outcome = await monitorAllocation(slurm, submissions, {
      onUpdate: (subs: StrategySubmission[]) => {
        if (!monitorSpinner) return;
        const pending = subs.filter(
          (s) => s.state === "PENDING" || s.state === "CONFIGURING",
        ).length;
        const elapsed = Math.round((Date.now() - jobStartMs) / 1000);
        monitorSpinner.text = `Waiting... ${pending} pending (${elapsed}s)`;
      },
    });

    monitorSpinner?.stop();

    // Verify actual GPU hardware on the allocated node
    await verifyAllocation(slurm, outcome);

    const winner = outcome.winner;
    const node =
      winner.nodes.length > 1
        ? winner.nodes.join(",")
        : (winner.nodes[0] ?? "unknown");
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
    const logBase = `/scratch/${config.connection.user}/.rv/logs/${request.jobName}-${winner.jobId}`;
    const outPath = `${logBase}.out`;
    const errPath = `${logBase}.err`;
    const nodeCount = winner.strategy.nodes;
    const jobResult = await tailJobLogs(slurm, winner.jobId, outPath, errPath, {
      silent: isJson,
      nodeCount,
    });

    // Check for hardware failure → auto-retry with node exclusion
    if (jobResult.exitCode !== 0 && !isJson) {
      const elapsedSeconds = Math.round((Date.now() - jobStartMs) / 1000);
      let errContent: string;
      if (nodeCount > 1) {
        const nodeErrPaths = Array.from(
          { length: nodeCount },
          (_, i) => `${logBase}.node${i}.err`,
        );
        const results = await slurm.sshClient
          .execBatch(
            nodeErrPaths.map((p) => `tail -n 50 ${p} 2>/dev/null || true`),
          )
          .catch(() => [] as string[]);
        errContent = results.join("\n");
      } else {
        errContent = await slurm.sshClient
          .exec(`tail -n 100 ${errPath} 2>/dev/null || true`)
          .catch(() => "");
      }
      const retry = analyzeForHardwareRetry(
        errContent,
        winner.nodes,
        elapsedSeconds,
        retryCount,
        request.excludeNodes,
      );
      if (retry.shouldRetry) {
        console.log(
          theme.warning(
            `\n  Hardware error on ${node} — retrying with node exclusion...`,
          ),
        );
        request.excludeNodes = retry.excludeNodes;
        retryCount++;
        continue;
      }
    }

    // Post-job summary with actionable commands
    if (!isJson) {
      const ckptDir = `/scratch/${config.connection.user}/.rv/checkpoints/${request.jobName}-${winner.jobId}`;
      console.log(theme.muted("\n  Files on Rivanna:"));
      if (execution?.codeDir) {
        console.log(theme.muted(`    Workspace:    ${execution.codeDir}`));
      }
      if (execution?.workDir) {
        console.log(theme.muted(`    Snapshot:     ${execution.workDir}`));
      }
      if (nodeCount > 1) {
        console.log(
          theme.muted(
            `    Logs:         ${logBase}.node{0..${nodeCount - 1}}.{out,err}`,
          ),
        );
      } else {
        console.log(theme.muted(`    Logs:         ${logBase}.{out,err}`));
      }
      console.log(theme.muted(`    Checkpoints:  ${ckptDir}`));
      if (execution?.git) {
        const dirty = execution.git.dirty ? "*" : "";
        console.log(
          theme.muted(
            `    Git:          ${execution.git.branch}@${execution.git.commitHash}${dirty}`,
          ),
        );
      }
      console.log();
      if (execution?.codeDir) {
        console.log(theme.muted(`  rv sync pull ${execution.codeDir} .`));
      }
      console.log(theme.muted(`  rv logs --pull ${winner.jobId}`));
    }

    // Propagate remote job exit code
    if (jobResult.exitCode !== 0) {
      process.exit(jobResult.exitCode);
    }

    break;
  }
}
