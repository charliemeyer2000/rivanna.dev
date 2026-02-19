import type { TemplateOptions } from "@rivanna/shared";
import { generatePreamble, generateEpilogue } from "./base.ts";

/**
 * Generate a multi-node distributed training Slurm batch script.
 * Sets up NCCL environment, MASTER_ADDR/PORT, and wraps command with srun.
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

  // Master address/port setup
  lines.push(`# Set master address to first node`);
  lines.push(
    `export MASTER_ADDR=$(scontrol show hostnames $SLURM_JOB_NODELIST | head -n 1)`,
  );
  lines.push(`export MASTER_PORT=29500`);
  lines.push(`export WORLD_SIZE=$SLURM_NTASKS`);
  lines.push(`export NODE_RANK=$SLURM_PROCID`);
  lines.push("");

  // Run with srun
  lines.push(`# Run distributed command`);
  lines.push(`srun --export=ALL ${opts.command}`);

  lines.push(generateEpilogue(opts));

  return lines.join("\n");
}
