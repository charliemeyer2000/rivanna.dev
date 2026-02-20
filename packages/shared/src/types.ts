export type GPUType =
  | "mig"
  | "rtx3090"
  | "a6000"
  | "a40"
  | "a100_40"
  | "a100_80"
  | "v100"
  | "h200";

export interface GPUSpec {
  partition: string;
  gres: string;
  vramGB: number;
  suPerGPUHour: number;
  maxPerUser: number;
  maxPerJob: number;
  maxWalltime: string;
  perNode: number;
  features?: readonly string[];
  hasInfiniBand?: boolean;
  hasNVLink?: boolean;
  /** Total CPU memory on the node in MB (from sinfo %m) */
  nodeMemoryMB: number;
}

// --- Slurm data types ---

export type NodeState = {
  name: string;
  state:
    | "idle"
    | "mixed"
    | "allocated"
    | "draining"
    | "drained"
    | "down"
    | "unknown";
  partition: string;
  gpuTotal: number;
  gpuAllocated: number;
  gpuAvailable: number;
  gresType: string;
  cpuTotal: number;
  cpuAllocated: number;
  memoryTotalMB: number;
};

/**
 * All 24 possible job states that `squeue %T` can return, plus UNKNOWN fallback.
 * Source: https://slurm.schedmd.com/job_state_codes.html
 */
export type JobState =
  // Base states (12)
  | "RUNNING"
  | "PENDING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMEOUT"
  | "NODE_FAIL"
  | "PREEMPTED"
  | "SUSPENDED"
  | "BOOT_FAIL"
  | "DEADLINE"
  | "OUT_OF_MEMORY"
  // Flag states visible in squeue (12)
  | "COMPLETING"
  | "CONFIGURING"
  | "RESIZING"
  | "REQUEUED"
  | "REQUEUE_FED"
  | "REQUEUE_HOLD"
  | "SPECIAL_EXIT"
  | "STOPPED"
  | "REVOKED"
  | "RESV_DEL_HOLD"
  | "SIGNALING"
  | "STAGE_OUT"
  // Fallback
  | "UNKNOWN";

export interface Job {
  id: string;
  name: string;
  user: string;
  state: JobState;
  partition: string;
  gres: string;
  timeElapsed: string;
  timeElapsedSeconds: number;
  timeLimit: string;
  timeLimitSeconds: number;
  nodes: string[];
  reason: string;
  /** Estimated start time for PENDING jobs (ISO 8601), actual start for RUNNING */
  startTime?: string;
}

export interface StorageQuota {
  mountPoint: string;
  type: string;
  usedBytes: number;
  totalBytes: number;
  usedPercent: number;
}

export interface SUAccount {
  name: string;
  balanceSU: number;
  usedSU: number;
}

export interface SUBalance {
  accounts: SUAccount[];
}

export interface JobAccounting {
  id: string;
  name: string;
  state: string;
  elapsed: string;
  elapsedSeconds: number;
  exitCode: string;
  partition: string;
  nodes?: string;
}

export interface TestOnlyResult {
  estimatedStart: Date | null;
  rawOutput: string;
}

export interface SbatchOptions {
  partition: string;
  gres: string;
  time: string;
  timeMin?: string;
  account: string;
  jobName: string;
  nodes?: number;
  ntasks?: number;
  cpusPerTask?: number;
  memPerCpu?: string;
  mem?: string;
  output?: string;
  error?: string;
  features?: string[];
  exclusive?: boolean;
  excludeNodes?: string;
}

export interface TemplateOptions extends SbatchOptions {
  user: string;
  command: string;
  workDir?: string;
  moduleLoads?: string[];
  envFileDir?: string;
  notifyUrl?: string;
  notifyToken?: string;
  totalTimeSeconds?: number;
  walltimeSeconds?: number;
  bufferSeconds?: number;
  ncclDebug?: boolean;
  venvPath?: string;
  sharedHfCache?: string;
}

export interface SystemState {
  nodes: NodeState[];
  runningJobs: Job[];
  pendingJobs: Job[];
  fairshare: number;
  timestamp: Date;
}

// --- Allocator types ---

export type StrategyKind =
  | "direct"
  | "backfill"
  | "checkpoint"
  | "mig"
  | "interactive";

export type TopologyKind = "single-node" | "multi-node";

export interface UserRequest {
  gpuCount: number;
  gpuType?: GPUType;
  vramMin?: number;
  totalTimeSeconds: number;
  totalTime: string;
  command?: string;
  jobName: string;
  account: string;
  user: string;
  workDir?: string;
  moduleLoads?: string[];
  /** User-specified total memory (--mem), overrides auto-calculation */
  mem?: string;
  venvPath?: string;
  notifyUrl?: string;
  notifyToken?: string;
  sharedHfCache?: string;
  /** Nodes to exclude from scheduling (set by hardware-retry) */
  excludeNodes?: string;
}

export interface BackfillProbe {
  gpuType: GPUType;
  partition: string;
  maxBackfillSeconds: number;
  fullyBackfillable: boolean;
}

export interface Strategy {
  id: string;
  kind: StrategyKind;
  gpuType: GPUType;
  partition: string;
  gres: string;
  walltime: string;
  walltimeSeconds: number;
  timeMin?: string;
  timeMinSeconds?: number;
  gpusPerNode: number;
  nodes: number;
  topology: TopologyKind;
  checkpointRestart: boolean;
  estimatedSU: number;
  estimatedWaitSeconds: number;
  backfillEligible: boolean;
  features?: string[];
  score: number;
  label: string;
}

export interface StrategySubmission {
  strategy: Strategy;
  jobId: string;
  state: JobState;
  nodes: string[];
}

export interface AllocatorResult {
  systemState: SystemState;
  backfillProbes: BackfillProbe[];
  strategies: Strategy[];
  compatibleGPUs: GPUType[];
}

export interface AllocationOutcome {
  winner: StrategySubmission;
  allSubmissions: StrategySubmission[];
  allocationTimeMs: number;
  /** Actual GPU hardware detected on the allocated node(s) */
  actualGPU?: {
    type: string;
    vramGB?: number;
    count: number;
    node: string;
    mismatch: boolean;
  };
}

// --- Port forward tracking ---

export interface ForwardEntry {
  pid: number;
  jobId: string;
  localPort: number;
  remotePort: number;
  node: string;
  startedAt: string; // ISO 8601
}

// --- Status dashboard ---

export interface GPUAvailabilitySummary {
  gpuType: GPUType;
  partition: string;
  totalGPUs: number;
  availableGPUs: number;
  utilizationPercent: number;
  suPerGPUHour: number;
}

// --- Config types ---

export interface RvConfig {
  connection: {
    host: string;
    user: string;
    hostname: string;
  };
  defaults: {
    account: string;
    gpu_type: string;
    time: string;
    partition: string;
    ai_naming?: boolean;
    ai_api_key?: string;
  };
  paths: {
    scratch: string;
    home: string;
  };
  notifications: {
    enabled: boolean;
    email: string;
    token?: string;
  };
  scratch_keepalive?: {
    enabled: boolean;
  };
  shared?: {
    hf_cache?: string;
  };
}
