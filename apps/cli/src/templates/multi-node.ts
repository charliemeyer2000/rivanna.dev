import type { TemplateOptions } from "@rivanna/shared";
import { PATHS } from "@rivanna/shared";
import { generatePreamble, generateEpilogue } from "./base.ts";

// --------------- Helpers ---------------

const TORCHRUN_RE = /^torchrun\b/;
const TORCH_DIST_RE = /^python\s+-m\s+torch\.distributed\.(launch|run)\b/;

/**
 * Detect if the command uses torchrun or python -m torch.distributed.run.
 */
function isTorchrun(command: string): boolean {
  const trimmed = command.trim();
  return TORCHRUN_RE.test(trimmed) || TORCH_DIST_RE.test(trimmed);
}

/**
 * Check if a CLI flag is already present in the command.
 */
function hasFlag(command: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|=|$)`).test(command);
}

/**
 * Inject multi-node flags into a torchrun command.
 * Inserts after "torchrun" (or "python -m torch.distributed.run").
 */
function injectTorchrunFlags(command: string): string {
  const flags: string[] = [];
  if (!hasFlag(command, "--nnodes")) flags.push("--nnodes=$SLURM_NNODES");
  if (!hasFlag(command, "--node-rank")) flags.push("--node-rank=$SLURM_PROCID");
  if (!hasFlag(command, "--master-addr"))
    flags.push("--master-addr=$MASTER_ADDR");
  if (!hasFlag(command, "--master-port"))
    flags.push("--master-port=$MASTER_PORT");

  if (flags.length === 0) return command;
  const injection = flags.join(" ");

  const trimmed = command.trim();
  if (TORCHRUN_RE.test(trimmed)) {
    return trimmed.replace(/^torchrun/, `torchrun ${injection}`);
  }
  return trimmed.replace(
    /(python\s+-m\s+torch\.distributed\.\w+)/,
    `$1 ${injection}`,
  );
}

/**
 * Escape single quotes for embedding inside a bash -c '...' wrapper.
 * Replaces ' with '\'' (end quote, escaped literal, start quote).
 */
function escapeForBashC(cmd: string): string {
  return cmd.replace(/'/g, "'\\''");
}

// --------------- Template ---------------

/**
 * Generate a multi-node distributed training Slurm batch script.
 * Sets up NCCL environment, MASTER_ADDR, and wraps command with srun.
 *
 * Key design: all per-node variables (NODE_RANK, SLURM_PROCID) are
 * expanded inside a `bash -c '...'` wrapper so each srun task gets
 * its correct value, not the sbatch-context value of 0.
 */
export function generateMultiNodeScript(opts: TemplateOptions): string {
  const lines: string[] = [];

  lines.push(generatePreamble(opts));

  // NCCL configuration
  lines.push(`# NCCL distributed training setup`);
  lines.push(`export NCCL_IB_DISABLE=0`);
  lines.push(`export NCCL_NET_GDR_LEVEL=PHB`);
  if (opts.ncclDebug) {
    lines.push(`export NCCL_DEBUG=INFO`);
  }
  lines.push("");

  // Master address (MASTER_PORT already set in base preamble)
  lines.push(`# Set master address to first node`);
  lines.push(
    `export MASTER_ADDR=$(scontrol show hostnames $SLURM_JOB_NODELIST | head -n 1)`,
  );
  lines.push("");

  // Build the inner command (with torchrun flag injection if needed)
  const innerCmd = isTorchrun(opts.command)
    ? injectTorchrunFlags(opts.command)
    : opts.command;
  const escaped = escapeForBashC(innerCmd);

  // Per-task env vars — must be set inside srun context, not sbatch body.
  // SLURM_PROCID is only correct inside each srun task.
  const envSetup = [
    "export NODE_RANK=$SLURM_PROCID",
    "export RANK=$SLURM_PROCID",
    "export WORLD_SIZE=$SLURM_NTASKS",
    "export MACHINE_RANK=$SLURM_PROCID",
  ].join("; ");

  // Per-node log files: srun --output/--error with %t (task ID = node index)
  const logDir = PATHS.logs(opts.user);

  lines.push(`# Run distributed command`);
  lines.push(
    `# bash -c ensures SLURM_PROCID expands per-task, not in sbatch context`,
  );
  lines.push(
    `srun --output=${logDir}/%x-%j.node%t.out --error=${logDir}/%x-%j.node%t.err \\`,
  );
  lines.push(`     --export=ALL bash -c '${envSetup}; exec ${escaped}'`);

  lines.push(generateEpilogue(opts));

  return lines.join("\n");
}
