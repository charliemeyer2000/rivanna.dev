import { homedir } from "os";
import { join } from "path";

// Local config
export const RV_DIR = join(homedir(), ".rv");
export const CONFIG_FILE = join(RV_DIR, "config.toml");

// SSH paths
export const SSH_DIR = join(homedir(), ".ssh");
export const SSH_KEY_PATH = join(SSH_DIR, "id_ed25519");
export const SSH_SOCKETS_DIR = join(SSH_DIR, "sockets");
export const SSH_CONFIG_PATH = join(SSH_DIR, "config");

// SSH host alias used in rv-generated config
export const SSH_HOST_ALIAS = "rv-hpc";

// Default connection
export const DEFAULT_HOSTNAME = "login.hpc.virginia.edu";

// SSH config block markers (for idempotent updates)
export const SSH_CONFIG_MARKER_START = "# --- rv-hpc (managed by rv) ---";
export const SSH_CONFIG_MARKER_END = "# --- end rv-hpc ---";

// Delimiter for batched SSH commands
export const BATCH_DELIMITER = "___RV_DELIM___";

// Cache env var exports for remote .bashrc
export const CACHE_ENV_EXPORTS = (user: string) => [
  `export UV_CACHE_DIR=/scratch/${user}/.cache/uv`,
  `export PIP_CACHE_DIR=/scratch/${user}/.cache/pip`,
  `export HF_HOME=/scratch/${user}/.cache/huggingface`,
];

// .bashrc block markers
export const BASHRC_MARKER_START = "# --- rv cache config (managed by rv) ---";
export const BASHRC_MARKER_END = "# --- end rv cache config ---";

// Slurm command format strings
export const SINFO_FORMAT = "%N %T %G %C %m";
export const SQUEUE_FORMAT = "%i %j %T %M %l %P %b %N %R";
export const SACCT_FORMAT =
  "JobID,JobName,State,Elapsed,ExitCode,Partition,NodeList";

// Default module loads for Slurm scripts
export const DEFAULT_MODULES = ["cuda/12.8.0", "miniforge/24.11.3-py3.12"];

// Notification webhook URL
export const NOTIFY_URL = "https://www.rivanna.dev/api/notify";
export const NOTIFY_SECRET = "rv-hmac-9f3a7c2e1b";

// Local state files
export const ENV_FILE = join(RV_DIR, "env.json");
export const FORWARDS_FILE = join(RV_DIR, "forwards.json");

// Default sync exclusion patterns
export const DEFAULT_SYNC_EXCLUDES = [
  "*.bin",
  "*.safetensors",
  "*.gguf",
  "*.pt",
  "*.pth",
  "__pycache__/",
  "node_modules/",
  ".git/",
];

// Well-known ports for auto-detect
export const WELL_KNOWN_PORTS: Record<string, number> = {
  ray: 8265,
  jupyter: 8888,
  tensorboard: 6006,
  vllm: 8000,
  gradio: 7860,
};

// GPU type aliases (user-friendly names → canonical GPUType)
export const GPU_TYPE_ALIASES: Record<
  string,
  import("@rivanna/shared").GPUType
> = {
  a100: "a100_80",
  "a100-80": "a100_80",
  "a100-40": "a100_40",
  a6000: "a6000",
  a40: "a40",
  v100: "v100",
  h200: "h200",
  rtx3090: "rtx3090",
  "3090": "rtx3090",
  mig: "mig",
};
