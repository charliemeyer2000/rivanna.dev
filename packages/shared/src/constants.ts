import type { GPUSpec, GPUType, JobState } from "./types.ts";

/**
 * Slurm states where the job has definitively finished.
 * Everything not in this set is considered "alive" (still running or will run).
 * Source: https://slurm.schedmd.com/job_state_codes.html
 */
export const TERMINAL_STATES = new Set<JobState>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMEOUT",
  "NODE_FAIL",
  "PREEMPTED",
  "BOOT_FAIL",
  "DEADLINE",
  "OUT_OF_MEMORY",
  "REVOKED",
  "SPECIAL_EXIT",
]);

export const GPU_SPECS: Record<GPUType, GPUSpec> = {
  mig: {
    partition: "gpu-mig",
    gres: "gpu:1g.10gb",
    vramGB: 10,
    suPerGPUHour: 0,
    maxPerUser: 28,
    maxPerJob: 1,
    maxWalltime: "3-00:00:00",
    perNode: 56,
    nodeMemoryMB: 2_000_000, // ~2TB shared MIG node
  },
  rtx3090: {
    partition: "interactive-rtx3090",
    gres: "gpu:rtx3090",
    vramGB: 24,
    suPerGPUHour: 113.23,
    maxPerUser: 2,
    maxPerJob: 2,
    maxWalltime: "12:00:00",
    perNode: 4,
    nodeMemoryMB: 257_000, // ~256GB
  },
  a6000: {
    partition: "gpu-a6000",
    gres: "gpu:a6000",
    vramGB: 48,
    suPerGPUHour: 142.73,
    maxPerUser: 32,
    maxPerJob: 8,
    maxWalltime: "3-00:00:00",
    perNode: 8,
    nodeMemoryMB: 257_000, // ~256GB
  },
  a40: {
    partition: "gpu-a40",
    gres: "gpu:a40",
    vramGB: 48,
    suPerGPUHour: 186.69,
    maxPerUser: 32,
    maxPerJob: 8,
    maxWalltime: "3-00:00:00",
    perNode: 8,
    nodeMemoryMB: 257_000, // ~256GB
  },
  a100_40: {
    partition: "gpu-a100-40",
    gres: "gpu:a100",
    vramGB: 40,
    suPerGPUHour: 463.81,
    maxPerUser: 32,
    maxPerJob: 8,
    maxWalltime: "3-00:00:00",
    perNode: 8,
    nodeMemoryMB: 512_000, // ~512GB
  },
  a100_80: {
    partition: "gpu-a100-80",
    gres: "gpu:a100",
    vramGB: 80,
    suPerGPUHour: 508.89,
    maxPerUser: 32,
    maxPerJob: 8,
    maxWalltime: "3-00:00:00",
    perNode: 8,
    features: ["gpupod", "a100_80gb"],
    hasInfiniBand: true,
    hasNVLink: true,
    nodeMemoryMB: 1_000_000, // ~1TB
  },
  v100: {
    partition: "gpu-v100",
    gres: "gpu:v100",
    vramGB: 32,
    suPerGPUHour: 20.96,
    maxPerUser: 32,
    maxPerJob: 4,
    maxWalltime: "3-00:00:00",
    perNode: 4,
    nodeMemoryMB: 384_000, // ~384GB
  },
  h200: {
    partition: "gpu-h200",
    gres: "gpu:h200",
    vramGB: 141,
    suPerGPUHour: 816.67,
    maxPerUser: 4,
    maxPerJob: 4,
    maxWalltime: "3-00:00:00",
    perNode: 8,
    nodeMemoryMB: 1_500_000, // ~1.5TB
  },
} as const;

export const SCHEDULER_CONFIG = {
  backfillResolutionSeconds: 600,
  schedMinIntervalSeconds: 2,
  priorityDecayHalfLifeDays: 7,
  priorityMaxAgeDays: 28,
  preemptMode: "OFF",
  defaultWalltime: "5:00:00",
  recommendedWalltime: "2:59:00",
  maxSubmissions: 10000,
} as const;

export const PATHS = {
  rvDir: (user: string) => `/scratch/${user}/.rv`,
  logs: (user: string) => `/scratch/${user}/.rv/logs`,
  envFiles: (user: string) => `/scratch/${user}/.rv/env`,
  envs: (user: string) => `/scratch/${user}/.rv/envs`,
  wheels: (user: string) => `/scratch/${user}/.rv/wheels`,
  workspaces: (user: string) => `/scratch/${user}/rv-workspaces`,
  cache: {
    uv: (user: string) => `/scratch/${user}/.cache/uv`,
    pip: (user: string) => `/scratch/${user}/.cache/pip`,
    hf: (user: string) => `/scratch/${user}/.cache/huggingface`,
  },
} as const;
