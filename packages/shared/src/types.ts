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
