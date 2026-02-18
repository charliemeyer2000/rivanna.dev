import type { TemplateOptions } from "@rivanna/shared";
import { generatePreamble, generateCompletionNotify } from "./base.ts";

/**
 * Generate a Ray cluster Slurm batch script.
 * Starts Ray head on first node, workers on remaining nodes,
 * runs the user command, then tears down Ray.
 */
export function generateRayScript(opts: TemplateOptions): string {
  const rayPort = opts.rayPort ?? 6379;
  const dashboardPort = opts.dashboardPort ?? 8265;

  const lines: string[] = [];

  lines.push(generatePreamble(opts));

  lines.push(`# Ray cluster setup`);
  lines.push(
    `HEAD_NODE=$(scontrol show hostnames $SLURM_JOB_NODELIST | head -n 1)`,
  );
  lines.push(
    `HEAD_IP=$(srun --nodes=1 --ntasks=1 -w "$HEAD_NODE" hostname -I | awk '{print $1}')`,
  );
  lines.push("");

  // Start head node
  lines.push(`# Start Ray head`);
  lines.push(`srun --nodes=1 --ntasks=1 -w "$HEAD_NODE" \\`);
  lines.push(
    `  ray start --head --port=${rayPort} --dashboard-port=${dashboardPort} --block &`,
  );
  lines.push(`sleep 10`);
  lines.push("");

  // Start worker nodes
  lines.push(`# Start Ray workers on remaining nodes`);
  lines.push(
    `WORKER_NODES=$(scontrol show hostnames $SLURM_JOB_NODELIST | tail -n +2)`,
  );
  lines.push(`for node in $WORKER_NODES; do`);
  lines.push(`  srun --nodes=1 --ntasks=1 -w "$node" \\`);
  lines.push(`    ray start --address="$HEAD_IP:${rayPort}" --block &`);
  lines.push(`  sleep 5`);
  lines.push(`done`);
  lines.push("");

  lines.push(`# Wait for all workers to join`);
  lines.push(`sleep 10`);
  lines.push("");

  // Run user command
  lines.push(`# Run command`);
  lines.push(opts.command);
  lines.push("");

  // Tear down
  lines.push(`# Tear down Ray cluster`);
  lines.push(`ray stop`);

  lines.push(generateCompletionNotify(opts));

  return lines.join("\n");
}
