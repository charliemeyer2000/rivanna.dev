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

export type JobState =
  | "RUNNING"
  | "PENDING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMEOUT"
  | "NODE_FAIL"
  | "PREEMPTED"
  | "SUSPENDED"
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
}

export interface TestOnlyResult {
  estimatedStart: Date | null;
  rawOutput: string;
}

export interface SbatchOptions {
  partition: string;
  gres: string;
  time: string;
  account: string;
  jobName: string;
  nodes?: number;
  ntasks?: number;
  cpusPerTask?: number;
  memPerCpu?: string;
  output?: string;
  error?: string;
  features?: string[];
  exclusive?: boolean;
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
  rayPort?: number;
  dashboardPort?: number;
}

export interface SystemState {
  nodes: NodeState[];
  runningJobs: Job[];
  pendingJobs: Job[];
  fairshare: number;
  timestamp: Date;
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
}
