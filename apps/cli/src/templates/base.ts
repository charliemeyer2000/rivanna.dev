import type { TemplateOptions } from "@rivanna/shared";
import { PATHS } from "@rivanna/shared";
import { DEFAULT_MODULES, NOTIFY_SECRET } from "@/lib/constants.ts";

/**
 * Generate SBATCH preamble directives + environment setup.
 */
export function generatePreamble(opts: TemplateOptions): string {
  const lines: string[] = ["#!/bin/bash"];

  // SBATCH directives
  lines.push(`#SBATCH -p ${opts.partition}`);
  lines.push(`#SBATCH --gres=${opts.gres}`);
  lines.push(`#SBATCH -t ${opts.time}`);
  if (opts.timeMin) lines.push(`#SBATCH --time-min=${opts.timeMin}`);
  lines.push(`#SBATCH -A ${opts.account}`);
  lines.push(`#SBATCH -J ${opts.jobName}`);

  const logDir = PATHS.logs(opts.user);
  lines.push(`#SBATCH -o ${opts.output ?? `${logDir}/%x-%j.out`}`);
  lines.push(`#SBATCH -e ${opts.error ?? `${logDir}/%x-%j.err`}`);

  if (opts.nodes) lines.push(`#SBATCH -N ${opts.nodes}`);
  if (opts.ntasks) lines.push(`#SBATCH --ntasks=${opts.ntasks}`);
  if (opts.cpusPerTask)
    lines.push(`#SBATCH --cpus-per-task=${opts.cpusPerTask}`);
  if (opts.mem) lines.push(`#SBATCH --mem=${opts.mem}`);
  else if (opts.memPerCpu)
    lines.push(`#SBATCH --mem-per-cpu=${opts.memPerCpu}`);
  if (opts.exclusive) lines.push("#SBATCH --exclusive");
  if (opts.features && opts.features.length > 0) {
    lines.push(`#SBATCH --constraint=${opts.features.join("&")}`);
  }
  if (opts.excludeNodes) {
    lines.push(`#SBATCH --exclude=${opts.excludeNodes}`);
  }

  lines.push("");

  // Module loads
  const modules = opts.moduleLoads ?? DEFAULT_MODULES;
  if (modules.length > 0) {
    lines.push(`module load ${modules.join(" ")}`);
    lines.push("");
  }

  // Source env file (written by SlurmClient.writeEnvFile before submission)
  const envDir = opts.envFileDir ?? PATHS.envFiles(opts.user);
  lines.push(`# Source per-job env vars (if any)`);
  lines.push(`if [ -f "${envDir}/$SLURM_JOB_ID.env" ]; then`);
  lines.push(`  source "${envDir}/$SLURM_JOB_ID.env"`);
  lines.push(`  rm -f "${envDir}/$SLURM_JOB_ID.env"`);
  lines.push("fi");
  lines.push("");

  // Notification hook (HMAC-signed)
  if (opts.notifyUrl) {
    lines.push(`# rv notification hook`);
    lines.push(`_rv_notify() {`);
    lines.push(`  local _ep=$(date +%s)`);
    lines.push(
      `  local _sg=$(echo -n "\${USER}:\${SLURM_JOB_ID}:\${1}:\${_ep}" | openssl dgst -sha256 -hmac "${NOTIFY_SECRET}" | awk '{print $NF}')`,
    );
    lines.push(`  curl -sf -X POST "${opts.notifyUrl}" \\`);
    lines.push(`    -H "Content-Type: application/json" \\`);
    lines.push(
      `    -d "{\\"user\\":\\"$USER\\",\\"jobId\\":\\"$SLURM_JOB_ID\\",\\"jobName\\":\\"$SLURM_JOB_NAME\\",\\"event\\":\\"$1\\",\\"node\\":\\"$(hostname)\\",\\"ts\\":\\"$(date -Iseconds)\\",\\"epoch\\":\${_ep},\\"sig\\":\\"\${_sg}\\"}" 2>/dev/null &`,
    );
    lines.push(`}`);
    lines.push(`_rv_notify STARTED`);
    lines.push("");
  }

  // Activate project venv (if deps were resolved)
  if (opts.venvPath) {
    lines.push(`# Activate project environment`);
    lines.push(`source "${opts.venvPath}/bin/activate"`);
    lines.push("");
  }

  // Prevent CPU oversubscription: each GPU process should use limited
  // OpenMP threads, not all available cores. Without this, torchrun with
  // N ranks each spawns os.cpu_count() threads → massive contention.
  if (opts.cpusPerTask) {
    lines.push(`export OMP_NUM_THREADS=${opts.cpusPerTask}`);
  } else {
    lines.push(`export OMP_NUM_THREADS=1`);
  }
  lines.push(`export TOKENIZERS_PARALLELISM=false`);
  lines.push("");

  // Dynamic MASTER_PORT prevents collisions when multiple torchrun/DDP
  // jobs land on the same node. Range: 29500-30499.
  lines.push(`export MASTER_PORT=$((29500 + SLURM_JOB_ID % 1000))`);
  lines.push("");

  // Cache directories — all on scratch to avoid filling home quota
  lines.push(`# Cache directories`);
  lines.push(`export UV_CACHE_DIR=${PATHS.cache.uv(opts.user)}`);
  lines.push(`export PIP_CACHE_DIR=${PATHS.cache.pip(opts.user)}`);
  lines.push(
    `export HF_HOME=${opts.sharedHfCache ?? PATHS.cache.hf(opts.user)}`,
  );
  lines.push(`export VLLM_CACHE_DIR=${PATHS.rvDir(opts.user)}/cache/vllm`);
  lines.push("");

  // Framework checkpoint defaults → scratch (avoid filling home dir)
  // Include job ID for uniqueness — prevents collisions from repeated runs
  const checkpointDir = `${PATHS.rvDir(opts.user)}/checkpoints/\${SLURM_JOB_NAME}-\${SLURM_JOB_ID}`;
  lines.push(`# Default checkpoint directory (frameworks will use this)`);
  lines.push(`export RV_CHECKPOINT_DIR="${checkpointDir}"`);
  lines.push(`export CHECKPOINT_DIR="${checkpointDir}"`);
  lines.push(`mkdir -p "${checkpointDir}" 2>/dev/null || true`);
  lines.push("");

  // Working directory
  if (opts.workDir) {
    lines.push(`cd "${opts.workDir}"`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate the script epilogue: capture exit code, send correct
 * notification, and propagate the exit code to Slurm.
 *
 * @param exitCodeVar - If the caller already captured `$?` into a variable
 *   (e.g. checkpoint's `EXIT_CODE`), pass the variable name here to skip
 *   the `_rv_exit=$?` capture line.
 */
export function generateEpilogue(
  opts: TemplateOptions,
  exitCodeVar?: string,
): string {
  const lines: string[] = [];
  const v = exitCodeVar ?? "_rv_exit";
  if (!exitCodeVar) {
    lines.push(`${v}=$?`);
  }
  if (opts.notifyUrl) {
    lines.push(`if [ $${v} -ne 0 ]; then`);
    lines.push(`  _rv_notify FAILED`);
    lines.push(`else`);
    lines.push(`  _rv_notify COMPLETED`);
    lines.push(`fi`);
  }
  lines.push(`exit $${v}`);
  return "\n" + lines.join("\n") + "\n";
}
