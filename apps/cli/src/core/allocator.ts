import type {
  GPUType,
  GPUSpec,
  UserRequest,
  Strategy,
  StrategyKind,
  BackfillProbe,
  AllocatorResult,
  StrategySubmission,
  AllocationOutcome,
  JobState,
  TemplateOptions,
} from "@rivanna/shared";
import { GPU_SPECS } from "@rivanna/shared";
import type { SlurmClient } from "./slurm.ts";
import type { SSHClient } from "./ssh.ts";
import {
  generateSimpleScript,
  generateMultiNodeScript,
  generateCheckpointScript,
} from "@/templates/index.ts";
import { parseTimeToSeconds } from "@/parsers/index.ts";
import { AllocatorError } from "@/lib/errors.ts";

// --------------- Constants ---------------

const COARSE_PROBES_SECONDS = [
  1800, // 0:30:00
  3600, // 1:00:00
  7200, // 2:00:00
  10740, // 2:59:00
  14400, // 4:00:00
  21600, // 6:00:00
];

const REFINE_STEP_SECONDS = 900; // 15 minutes
const MAX_STRATEGIES = 16;
const BACKFILL_THRESHOLD_SECONDS = 300; // 5 minutes
const INITIAL_POLL_MS = 2000;
const MAX_POLL_MS = 10_000;
const POLL_BACKOFF = 1.5;
const MAX_POLL_DURATION_MS = 7_200_000; // 2 hours

// --------------- Helpers ---------------

function formatSeconds(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hms = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return days > 0 ? `${days}-${hms}` : hms;
}

function buildTestOnlyCommand(
  partition: string,
  gres: string,
  walltimeSeconds: number,
  account: string,
  gpuCount: number,
  features?: readonly string[],
): string {
  const time = formatSeconds(walltimeSeconds);
  const gresWithCount = `${gres}:${gpuCount}`;
  const constraint =
    features && features.length > 0
      ? ` --constraint=${features.join("&")}`
      : "";
  return `sbatch --test-only --wrap="sleep 1" -p ${partition} --gres=${gresWithCount} -t ${time} -A ${account} -J rv-probe${constraint} 2>&1 || true`;
}

function parseTestOnlyOutput(output: string): Date | null {
  const match = output.match(
    /to start at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
  );
  return match ? new Date(match[1]!) : null;
}

function isBackfillStart(estimatedStart: Date | null, now: Date): boolean {
  if (!estimatedStart) return false;
  const diffSeconds = (estimatedStart.getTime() - now.getTime()) / 1000;
  return diffSeconds < BACKFILL_THRESHOLD_SECONDS;
}

function estimateWaitFromProbe(
  probe: BackfillProbe | undefined,
  walltimeSeconds: number,
): number {
  if (!probe) return 3600;
  if (walltimeSeconds <= probe.maxBackfillSeconds) return 30;
  const overageRatio = walltimeSeconds / Math.max(probe.maxBackfillSeconds, 1);
  return Math.min(overageRatio * 3600, 86400);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------- Public Functions ---------------

/**
 * Filter GPU_SPECS by the user's requirements.
 * A type is compatible only if it can actually deliver the requested GPU count,
 * either on a single node or across 2 nodes.
 */
export function getCompatibleGPUs(request: UserRequest): GPUType[] {
  const entries = Object.entries(GPU_SPECS) as [GPUType, GPUSpec][];
  const vramMin = request.vramMin ?? 0;

  return entries
    .filter(([type, spec]) => {
      if (request.gpuType && request.gpuType !== type) return false;
      if (spec.vramGB < vramMin) return false;
      if (request.gpuCount > spec.maxPerUser) return false;
      if (type === "mig" && request.gpuCount !== 1) return false;
      if (type === "rtx3090" && request.gpuCount > spec.maxPerJob) return false;
      // For standard types: must be able to fulfill full GPU count.
      // Single-node: gpuCount <= maxPerJob.
      // Multi-node (2 nodes): ceil(gpuCount/2) <= perNode AND gpuCount <= maxPerUser.
      if (type !== "mig" && type !== "rtx3090") {
        const canSingleNode = request.gpuCount <= spec.maxPerJob;
        const gpusPerNode = Math.ceil(request.gpuCount / 2);
        const canMultiNode =
          request.gpuCount > 1 &&
          gpusPerNode <= spec.perNode &&
          request.gpuCount <= spec.maxPerUser;
        if (!canSingleNode && !canMultiNode) return false;
      }
      return true;
    })
    .map(([type]) => type);
}

/**
 * Probe backfill windows for all compatible GPU types.
 * Uses 2 SSH round-trips: one coarse pass, one refinement pass.
 */
export async function probeBackfillWindows(
  ssh: SSHClient,
  gpuTypes: GPUType[],
  gpuCount: number,
  account: string,
): Promise<BackfillProbe[]> {
  const now = new Date();
  const probes: BackfillProbe[] = [];

  // Round 1: Coarse probes
  type ProbeKey = { gpuType: GPUType; walltimeSeconds: number };
  const round1Commands: string[] = [];
  const round1Keys: ProbeKey[] = [];

  for (const gpuType of gpuTypes) {
    const spec = GPU_SPECS[gpuType];
    const maxWalltimeSeconds = parseTimeToSeconds(spec.maxWalltime);
    // Probe at the count we'll actually request per node.
    // If single-node is possible, probe at full count.
    // Otherwise (multi-node only), probe at ceil(count/2) per node.
    const probeGpuCount =
      gpuCount <= spec.maxPerJob ? gpuCount : Math.ceil(gpuCount / 2);

    for (const probeSeconds of COARSE_PROBES_SECONDS) {
      if (probeSeconds > maxWalltimeSeconds) continue;
      round1Commands.push(
        buildTestOnlyCommand(
          spec.partition,
          spec.gres,
          probeSeconds,
          account,
          probeGpuCount,
          spec.features,
        ),
      );
      round1Keys.push({ gpuType, walltimeSeconds: probeSeconds });
    }
  }

  if (round1Commands.length === 0) return probes;

  const round1Results = await ssh.execBatch(round1Commands);

  // Analyze: group by GPU type, find cliff
  const resultsByType = new Map<
    GPUType,
    { seconds: number; backfill: boolean }[]
  >();
  for (let i = 0; i < round1Keys.length; i++) {
    const key = round1Keys[i]!;
    const output = round1Results[i] ?? "";
    const estimatedStart = parseTestOnlyOutput(output);
    const bf = isBackfillStart(estimatedStart, now);

    let arr = resultsByType.get(key.gpuType);
    if (!arr) {
      arr = [];
      resultsByType.set(key.gpuType, arr);
    }
    arr.push({ seconds: key.walltimeSeconds, backfill: bf });
  }

  const cliffMap = new Map<
    GPUType,
    { lastBackfill: number; firstNonBackfill: number }
  >();

  for (const [gpuType, results] of resultsByType) {
    results.sort((a, b) => a.seconds - b.seconds);

    let lastBackfill = 0;
    let firstNonBackfill = Infinity;
    let allBackfill = true;

    for (const r of results) {
      if (r.backfill) {
        lastBackfill = Math.max(lastBackfill, r.seconds);
      } else {
        firstNonBackfill = Math.min(firstNonBackfill, r.seconds);
        allBackfill = false;
      }
    }

    if (allBackfill) {
      const maxTested = results[results.length - 1]!.seconds;
      probes.push({
        gpuType,
        partition: GPU_SPECS[gpuType].partition,
        maxBackfillSeconds: maxTested,
        fullyBackfillable: true,
      });
    } else if (lastBackfill === 0) {
      probes.push({
        gpuType,
        partition: GPU_SPECS[gpuType].partition,
        maxBackfillSeconds: 0,
        fullyBackfillable: false,
      });
    } else {
      cliffMap.set(gpuType, { lastBackfill, firstNonBackfill });
    }
  }

  // Round 2: Refine around cliffs
  if (cliffMap.size > 0) {
    const round2Commands: string[] = [];
    const round2Keys: ProbeKey[] = [];

    for (const [gpuType, cliff] of cliffMap) {
      const spec = GPU_SPECS[gpuType];
      const probeGpuCount =
        gpuCount <= spec.maxPerJob ? gpuCount : Math.ceil(gpuCount / 2);
      for (
        let s = cliff.lastBackfill + REFINE_STEP_SECONDS;
        s < cliff.firstNonBackfill;
        s += REFINE_STEP_SECONDS
      ) {
        round2Commands.push(
          buildTestOnlyCommand(
            spec.partition,
            spec.gres,
            s,
            account,
            probeGpuCount,
            spec.features,
          ),
        );
        round2Keys.push({ gpuType, walltimeSeconds: s });
      }
    }

    if (round2Commands.length > 0) {
      const round2Results = await ssh.execBatch(round2Commands);

      for (let i = 0; i < round2Keys.length; i++) {
        const key = round2Keys[i]!;
        const output = round2Results[i] ?? "";
        const estimatedStart = parseTestOnlyOutput(output);
        const bf = isBackfillStart(estimatedStart, now);

        const cliff = cliffMap.get(key.gpuType)!;
        if (bf) {
          cliff.lastBackfill = Math.max(
            cliff.lastBackfill,
            key.walltimeSeconds,
          );
        } else {
          cliff.firstNonBackfill = Math.min(
            cliff.firstNonBackfill,
            key.walltimeSeconds,
          );
        }
      }
    }

    for (const [gpuType, cliff] of cliffMap) {
      probes.push({
        gpuType,
        partition: GPU_SPECS[gpuType].partition,
        maxBackfillSeconds: cliff.lastBackfill,
        fullyBackfillable: false,
      });
    }
  }

  return probes;
}

/**
 * Generate all viable allocation strategies.
 *
 * Philosophy: generate EVERY viable way to fulfill the request. We submit all
 * of them simultaneously and let Slurm's scheduler pick the winner. More
 * strategies = more chances to get scheduled fast.
 *
 * For each compatible GPU type, we generate up to 4 variants:
 *   - Direct single-node (full walltime)
 *   - Direct multi-node 2x (full walltime, if gpuCount allows)
 *   - Checkpoint single-node (backfill-ceiling walltime, if backfill exists)
 *   - Checkpoint multi-node 2x (backfill-ceiling walltime, if both apply)
 *
 * Plus MIG and interactive RTX 3090 as special cases.
 */
export function generateStrategies(
  request: UserRequest,
  backfillProbes: BackfillProbe[],
  compatibleGPUs: GPUType[],
): Strategy[] {
  const strategies: Strategy[] = [];
  let idCounter = 0;
  const nextId = () => `strat-${++idCounter}`;

  const probeMap = new Map<GPUType, BackfillProbe>();
  for (const probe of backfillProbes) {
    probeMap.set(probe.gpuType, probe);
  }

  for (const gpuType of compatibleGPUs) {
    const spec = GPU_SPECS[gpuType];
    const probe = probeMap.get(gpuType);
    const maxWalltimeSeconds = parseTimeToSeconds(spec.maxWalltime);

    // MIG and interactive handled separately below
    if (gpuType === "mig" || gpuType === "rtx3090") continue;

    const gpuCount = request.gpuCount;
    const suPerHour = spec.suPerGPUHour * gpuCount;
    const canSingleNode = gpuCount <= spec.maxPerJob;
    const gpusPerNode = Math.ceil(gpuCount / 2);
    const canMultiNode = gpuCount >= 4 && gpusPerNode <= spec.perNode;

    // --- Single-node strategies ---
    if (canSingleNode) {
      const gresStr = `${spec.gres}:${gpuCount}`;

      // Direct at full walltime
      if (request.totalTimeSeconds <= maxWalltimeSeconds) {
        const walltimeSeconds = request.totalTimeSeconds;
        const backfillEligible = probe
          ? walltimeSeconds <= probe.maxBackfillSeconds
          : false;
        const kind: StrategyKind = backfillEligible ? "backfill" : "direct";

        // --time-min: for non-backfill strategies with a backfill window,
        // tell Slurm we'll accept any gap >= backfill ceiling
        const timeMinSeconds =
          !backfillEligible && probe && probe.maxBackfillSeconds > 0
            ? probe.maxBackfillSeconds
            : undefined;

        strategies.push({
          id: nextId(),
          kind,
          gpuType,
          partition: spec.partition,
          gres: gresStr,
          walltime: request.totalTime,
          walltimeSeconds,
          timeMin: timeMinSeconds ? formatSeconds(timeMinSeconds) : undefined,
          timeMinSeconds,
          gpusPerNode: gpuCount,
          nodes: 1,
          topology: "single-node",
          checkpointRestart: false,
          estimatedSU: suPerHour * (walltimeSeconds / 3600),
          estimatedWaitSeconds: timeMinSeconds
            ? estimateWaitFromProbe(probe, timeMinSeconds)
            : estimateWaitFromProbe(probe, walltimeSeconds),
          backfillEligible: backfillEligible || !!timeMinSeconds,
          features: spec.features ? [...spec.features] : undefined,
          score: 0,
          label: `${gpuCount}x ${gpuType.toUpperCase()}, ${kind}${timeMinSeconds ? "+timemin" : ""}, ${request.totalTime}`,
        });
      }

      // Checkpoint at backfill ceiling
      if (
        probe &&
        probe.maxBackfillSeconds > 0 &&
        request.totalTimeSeconds > probe.maxBackfillSeconds
      ) {
        const walltimeSeconds = probe.maxBackfillSeconds;
        const walltime = formatSeconds(walltimeSeconds);

        strategies.push({
          id: nextId(),
          kind: "checkpoint",
          gpuType,
          partition: spec.partition,
          gres: gresStr,
          walltime,
          walltimeSeconds,
          gpusPerNode: gpuCount,
          nodes: 1,
          topology: "single-node",
          checkpointRestart: true,
          estimatedSU: suPerHour * (request.totalTimeSeconds / 3600),
          estimatedWaitSeconds: 30,
          backfillEligible: true,
          features: spec.features ? [...spec.features] : undefined,
          score: 0,
          label: `${gpuCount}x ${gpuType.toUpperCase()}, checkpoint, ${walltime} segments`,
        });
      }
    }

    // --- Multi-node strategies (2 nodes) ---
    if (canMultiNode) {
      const multiGres = `${spec.gres}:${gpusPerNode}`;

      // Direct multi-node at full walltime
      if (request.totalTimeSeconds <= maxWalltimeSeconds) {
        const walltimeSeconds = request.totalTimeSeconds;
        const backfillEligible = probe
          ? walltimeSeconds <= probe.maxBackfillSeconds
          : false;
        const kind: StrategyKind = backfillEligible ? "backfill" : "direct";

        const timeMinSeconds =
          !backfillEligible && probe && probe.maxBackfillSeconds > 0
            ? probe.maxBackfillSeconds
            : undefined;

        strategies.push({
          id: nextId(),
          kind,
          gpuType,
          partition: spec.partition,
          gres: multiGres,
          walltime: request.totalTime,
          walltimeSeconds,
          timeMin: timeMinSeconds ? formatSeconds(timeMinSeconds) : undefined,
          timeMinSeconds,
          gpusPerNode,
          nodes: 2,
          topology: "multi-node",
          checkpointRestart: false,
          estimatedSU: suPerHour * (walltimeSeconds / 3600),
          estimatedWaitSeconds: timeMinSeconds
            ? estimateWaitFromProbe(probe, timeMinSeconds)
            : estimateWaitFromProbe(probe, walltimeSeconds),
          backfillEligible: backfillEligible || !!timeMinSeconds,
          features: spec.features ? [...spec.features] : undefined,
          score: 0,
          label: `${gpuCount}x ${gpuType.toUpperCase()} (2x${gpusPerNode}), multi-node${timeMinSeconds ? "+timemin" : ""}, ${request.totalTime}`,
        });
      }

      // Checkpoint multi-node at backfill ceiling
      if (
        probe &&
        probe.maxBackfillSeconds > 0 &&
        request.totalTimeSeconds > probe.maxBackfillSeconds
      ) {
        const walltimeSeconds = probe.maxBackfillSeconds;
        const walltime = formatSeconds(walltimeSeconds);

        strategies.push({
          id: nextId(),
          kind: "checkpoint",
          gpuType,
          partition: spec.partition,
          gres: multiGres,
          walltime,
          walltimeSeconds,
          gpusPerNode,
          nodes: 2,
          topology: "multi-node",
          checkpointRestart: true,
          estimatedSU: suPerHour * (request.totalTimeSeconds / 3600),
          estimatedWaitSeconds: 30,
          backfillEligible: true,
          features: spec.features ? [...spec.features] : undefined,
          score: 0,
          label: `${gpuCount}x ${gpuType.toUpperCase()} (2x${gpusPerNode}), ckpt+multi, ${walltime} segments`,
        });
      }
    }
  }

  // --- MIG (free, instant) ---
  if (
    request.gpuCount === 1 &&
    (!request.gpuType || request.gpuType === "mig") &&
    (request.vramMin ?? 0) <= 10
  ) {
    const migSpec = GPU_SPECS.mig;
    const maxWalltimeSeconds = parseTimeToSeconds(migSpec.maxWalltime);
    const walltimeSeconds = Math.min(
      request.totalTimeSeconds,
      maxWalltimeSeconds,
    );

    strategies.push({
      id: nextId(),
      kind: "mig",
      gpuType: "mig",
      partition: migSpec.partition,
      gres: migSpec.gres,
      walltime: formatSeconds(walltimeSeconds),
      walltimeSeconds,
      gpusPerNode: 1,
      nodes: 1,
      topology: "single-node",
      checkpointRestart: false,
      estimatedSU: 0,
      estimatedWaitSeconds: 0,
      backfillEligible: true,
      score: 0,
      label: "1x MIG (FREE, instant)",
    });
  }

  // --- Interactive RTX 3090 ---
  if (
    request.gpuCount <= 2 &&
    request.totalTimeSeconds <= 12 * 3600 &&
    (!request.gpuType || request.gpuType === "rtx3090") &&
    (request.vramMin ?? 0) <= 24
  ) {
    const rtxSpec = GPU_SPECS.rtx3090;
    const walltimeSeconds = Math.min(
      request.totalTimeSeconds,
      parseTimeToSeconds(rtxSpec.maxWalltime),
    );

    strategies.push({
      id: nextId(),
      kind: "interactive",
      gpuType: "rtx3090",
      partition: rtxSpec.partition,
      gres: `${rtxSpec.gres}:${request.gpuCount}`,
      walltime: formatSeconds(walltimeSeconds),
      walltimeSeconds,
      gpusPerNode: request.gpuCount,
      nodes: 1,
      topology: "single-node",
      checkpointRestart: false,
      estimatedSU:
        rtxSpec.suPerGPUHour * request.gpuCount * (walltimeSeconds / 3600),
      estimatedWaitSeconds: 10,
      backfillEligible: true,
      score: 0,
      label: `${request.gpuCount}x RTX 3090, interactive, ${formatSeconds(walltimeSeconds)}`,
    });
  }

  return strategies;
}

/**
 * Score and rank strategies. Cap at MAX_STRATEGIES.
 *
 * Philosophy: we submit ALL strategies simultaneously and let Slurm pick the
 * winner. Ranking determines display order and the cap. We only prune truly
 * redundant strategies within the SAME GPU type + topology — never across
 * types, because the whole point of fan-out is that we can't predict which
 * type the scheduler will start first.
 */
export function rankStrategies(
  strategies: Strategy[],
  request: UserRequest,
): Strategy[] {
  if (strategies.length === 0) return [];

  const maxSU = Math.max(...strategies.map((s) => s.estimatedSU), 1);

  // Score each strategy for display ordering
  const scored = strategies.map((strategy) => {
    let score = 0;

    // Backfill-eligible strategies are our best bet
    if (strategy.backfillEligible) score += 10000;
    // Penalize estimated wait
    score -= strategy.estimatedWaitSeconds;
    // Bonus for matching user's requested type
    if (request.gpuType && strategy.gpuType === request.gpuType) score += 500;
    // Cost efficiency bonus (cheaper is better, all else equal)
    score += 2000 * (1 - strategy.estimatedSU / maxSU);
    // Mild checkpoint penalty (segments add complexity)
    if (strategy.checkpointRestart) score -= 200;
    // MIG is free and instant
    if (strategy.kind === "mig") score += 1000;
    // Interactive is nearly instant
    if (strategy.kind === "interactive") score += 300;

    return { ...strategy, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Prune only within same GPU type + topology.
  // Within a type+topology group, a checkpoint strategy that's backfill-eligible
  // dominates a direct strategy with long wait (same type, same topology).
  // But NEVER prune across different GPU types — that's the fan-out.
  const pruned: Strategy[] = [];
  for (const candidate of scored) {
    const dominated = pruned.some(
      (existing) =>
        existing.gpuType === candidate.gpuType &&
        existing.topology === candidate.topology &&
        existing.checkpointRestart === candidate.checkpointRestart &&
        existing.estimatedWaitSeconds <= candidate.estimatedWaitSeconds &&
        existing.estimatedSU <= candidate.estimatedSU,
    );
    if (!dominated) {
      pruned.push(candidate);
    }
  }

  return pruned.slice(0, MAX_STRATEGIES);
}

/**
 * Generate the Slurm batch script for a strategy.
 */
export function buildScript(strategy: Strategy, request: UserRequest): string {
  // Auto-set total memory (--mem) if user didn't specify.
  // Give a proportional share of node memory based on GPU fraction requested,
  // with extra overhead. ML workloads need substantial CPU memory for data
  // loading, NCCL buffers, model staging, and preprocessing.
  // e.g., 1 A100-80 on a 1TB node → ~190G, 8 A100-80 → ~900G
  let mem: string;
  if (request.mem) {
    // User explicitly set --mem, use as-is
    mem = request.mem;
  } else {
    // Auto-calculate: proportional share of node memory + overhead.
    // ML workloads need substantial CPU memory for data loading,
    // NCCL buffers, model staging, and preprocessing.
    // e.g., 1 A100-80 on 1TB node → ~183G, 8 A100-80 → ~878G
    const spec = GPU_SPECS[strategy.gpuType];
    if (strategy.gpuType === "mig") {
      // MIG slices share a large node — request modest memory to stay
      // within QOS limits. 16G is plenty for single-GPU MIG workloads.
      mem = "16G";
    } else {
      const nodeMemGB = Math.floor(spec.nodeMemoryMB / 1024);
      const gpuFraction = strategy.gpusPerNode / spec.perNode;
      const proportionalGB = Math.floor(nodeMemGB * gpuFraction);
      const withOverhead = Math.floor(proportionalGB * 1.5);
      const cappedGB = Math.min(withOverhead, Math.floor(nodeMemGB * 0.9));
      mem = `${Math.max(cappedGB, 16)}G`;
    }
  }

  // Auto-set CPUs per task. MIG QOS limits CPUs strictly; other partitions
  // benefit from enough CPUs for DataLoader workers and preprocessing.
  const cpusPerTask =
    strategy.gpuType === "mig"
      ? 1
      : Math.max(1, Math.min(strategy.gpusPerNode * 4, 32));

  const templateOpts: TemplateOptions = {
    partition: strategy.partition,
    gres: strategy.gres,
    time: strategy.walltime,
    timeMin: strategy.timeMin,
    account: request.account,
    jobName: request.jobName,
    user: request.user,
    command: request.command ?? "/bin/bash",
    nodes: strategy.nodes > 1 ? strategy.nodes : undefined,
    ntasks: strategy.nodes > 1 ? strategy.nodes : undefined,
    cpusPerTask,
    mem,
    features: strategy.features,
    workDir: request.workDir,
    moduleLoads: request.moduleLoads,
    venvPath: request.venvPath,
    notifyUrl: request.notifyUrl,
    notifyToken: request.notifyToken,
  };

  if (strategy.checkpointRestart) {
    return generateCheckpointScript({
      ...templateOpts,
      totalTimeSeconds: request.totalTimeSeconds,
      walltimeSeconds: strategy.walltimeSeconds,
      bufferSeconds: 600,
    });
  }

  if (strategy.topology === "multi-node") {
    return generateMultiNodeScript(templateOpts);
  }

  return generateSimpleScript(templateOpts);
}

/**
 * Main allocator entry point. Queries cluster, probes backfill, generates and ranks strategies.
 * Does NOT submit jobs — that's submitStrategies().
 */
export async function allocate(
  slurm: SlurmClient,
  request: UserRequest,
): Promise<AllocatorResult> {
  const systemState = await slurm.getSystemState();
  const compatibleGPUs = getCompatibleGPUs(request);

  if (compatibleGPUs.length === 0) {
    return { systemState, backfillProbes: [], strategies: [], compatibleGPUs };
  }

  // Only probe non-MIG, non-RTX3090 types (those are always instant)
  const probableTypes = compatibleGPUs.filter(
    (t) => t !== "mig" && t !== "rtx3090",
  );

  const backfillProbes =
    probableTypes.length > 0
      ? await probeBackfillWindows(
          slurm.sshClient,
          probableTypes,
          request.gpuCount,
          request.account,
        )
      : [];

  const rawStrategies = generateStrategies(
    request,
    backfillProbes,
    compatibleGPUs,
  );
  const strategies = rankStrategies(rawStrategies, request);

  return { systemState, backfillProbes, strategies, compatibleGPUs };
}

/**
 * Submit all ranked strategies simultaneously.
 */
export async function submitStrategies(
  slurm: SlurmClient,
  strategies: Strategy[],
  request: UserRequest,
  envVars?: Record<string, string>,
): Promise<StrategySubmission[]> {
  const submissions: StrategySubmission[] = [];
  const hasEnvVars = envVars && Object.keys(envVars).length > 0;

  const results = await Promise.allSettled(
    strategies.map(async (strategy) => {
      const script = buildScript(strategy, request);
      const jobId = await slurm.submitJob(script);
      if (hasEnvVars) {
        await slurm.writeEnvFile(jobId, envVars);
      }
      return { strategy, jobId };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      submissions.push({
        strategy: result.value.strategy,
        jobId: result.value.jobId,
        state: "PENDING" as JobState,
        nodes: [],
      });
    }
  }

  return submissions;
}

/**
 * Poll squeue until first submission reaches RUNNING. Cancel all others.
 */
export async function monitorAllocation(
  slurm: SlurmClient,
  submissions: StrategySubmission[],
  options?: {
    onUpdate?: (submissions: StrategySubmission[]) => void;
  },
): Promise<AllocationOutcome> {
  let pollInterval = INITIAL_POLL_MS;
  const startTime = Date.now();

  const submissionMap = new Map<string, StrategySubmission>();
  for (const sub of submissions) {
    submissionMap.set(sub.jobId, sub);
  }

  while (true) {
    if (Date.now() - startTime > MAX_POLL_DURATION_MS) {
      throw new AllocatorError(
        "Allocation timed out after 2 hours. All submissions are still pending.",
      );
    }

    const jobs = await slurm.getJobs();

    let winner: StrategySubmission | null = null;
    for (const job of jobs) {
      const sub = submissionMap.get(job.id);
      if (!sub) continue;

      sub.state = job.state;
      sub.nodes = job.nodes;

      if (job.state === "RUNNING" && !winner) {
        winner = sub;
      }
    }

    // Check for jobs that vanished from squeue (could be completed or failed).
    // Fast jobs may go PENDING → RUNNING → COMPLETED between polls.
    // Note: sacct has a lag — records may not appear immediately after completion.
    const vanished = Array.from(submissionMap.values()).filter(
      (s) =>
        (s.state === "PENDING" || s.state === "RUNNING") &&
        !jobs.some((j) => j.id === s.jobId),
    );
    if (vanished.length > 0) {
      const history = await slurm.getJobHistory("now-1hour");
      for (const sub of vanished) {
        const record = history.find((h) => h.id === sub.jobId);
        if (record?.state === "COMPLETED") {
          sub.state = "COMPLETED";
          if (record.nodes) sub.nodes = [record.nodes];
          if (!winner) winner = sub;
        } else if (record) {
          // sacct has a record with a terminal state (FAILED, CANCELLED, etc.)
          sub.state = "FAILED";
        }
        // If no sacct record yet (accounting lag), leave state unchanged
        // so the next poll can check again.
      }
    }

    options?.onUpdate?.(Array.from(submissionMap.values()));

    if (winner) {
      const losers = Array.from(submissionMap.values()).filter(
        (s) =>
          s.jobId !== winner!.jobId &&
          (s.state === "PENDING" || s.state === "RUNNING"),
      );
      if (losers.length > 0) {
        await slurm.cancelJobs(losers.map((s) => s.jobId));
        for (const loser of losers) {
          loser.state = "CANCELLED";
        }
      }

      return {
        winner,
        allSubmissions: Array.from(submissionMap.values()),
        allocationTimeMs: Date.now() - startTime,
      };
    }

    const allDead = Array.from(submissionMap.values()).every(
      (s) => s.state !== "PENDING" && s.state !== "RUNNING",
    );
    if (allDead) {
      throw new AllocatorError(
        "All strategy submissions failed or were cancelled.",
      );
    }

    await sleep(pollInterval);
    pollInterval = Math.min(pollInterval * POLL_BACKOFF, MAX_POLL_MS);
  }
}

/**
 * Generate topology/NCCL warnings for the winning strategy.
 * Returns an array of warning strings to display.
 */
export function getTopologyWarnings(strategy: Strategy): string[] {
  const warnings: string[] = [];
  const spec = GPU_SPECS[strategy.gpuType];

  if (strategy.topology === "multi-node") {
    warnings.push(
      "Multi-node allocation: inter-node GPU communication uses network (InfiniBand/Ethernet).",
    );
    if (!spec.hasInfiniBand) {
      warnings.push(
        "This partition has no InfiniBand — multi-node NCCL will be slow. Consider single-node.",
      );
    }
    warnings.push(
      "Ensure your code uses distributed training (PyTorch DDP, DeepSpeed, etc.).",
    );
  }

  if (strategy.gpusPerNode > 1 && !spec.hasNVLink) {
    warnings.push(
      "Multi-GPU on this partition uses PCIe (no NVLink). Tensor parallelism will be slower than on A100-80.",
    );
  }

  return warnings;
}

// Map sinfo gres type strings → our GPUType
const GRES_TO_GPU_TYPE: Record<string, GPUType> = {
  a6000: "a6000",
  a40: "a40",
  a100: "a100_80", // ambiguous, but sinfo doesn't distinguish 40 vs 80
  v100: "v100",
  h200: "h200",
  rtx3090: "rtx3090",
  "1g.10gb": "mig",
};

// Friendly names for display
const GRES_DISPLAY_NAMES: Record<string, string> = {
  a6000: "A6000",
  a40: "A40",
  a100: "A100",
  v100: "V100",
  h200: "H200",
  rtx3090: "RTX 3090",
  "1g.10gb": "MIG",
};

/**
 * Verify the actual GPU hardware on the allocated node.
 * Returns GPU info with mismatch flag if hardware differs from strategy.
 */
export async function verifyAllocation(
  slurm: SlurmClient,
  outcome: AllocationOutcome,
): Promise<AllocationOutcome> {
  const node = outcome.winner.nodes[0];
  if (!node) return outcome;

  const nodeInfo = await slurm.getNodeInfo(node);
  if (!nodeInfo) return outcome;

  const actualType = GRES_TO_GPU_TYPE[nodeInfo.gresType];
  const strategyType = outcome.winner.strategy.gpuType;

  // Check mismatch: for a100, need to also check against a100_40
  const isMismatch =
    !!actualType &&
    actualType !== strategyType &&
    !(nodeInfo.gresType === "a100" && strategyType === "a100_40");

  outcome.actualGPU = {
    type: GRES_DISPLAY_NAMES[nodeInfo.gresType] ?? nodeInfo.gresType,
    count: outcome.winner.strategy.gpusPerNode * outcome.winner.strategy.nodes,
    node,
    mismatch: isMismatch,
  };

  return outcome;
}
