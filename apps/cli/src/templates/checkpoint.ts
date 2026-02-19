import type { TemplateOptions } from "@rivanna/shared";
import { generatePreamble, generateEpilogue } from "./base.ts";

/**
 * Generate a checkpoint-restart Slurm batch script.
 *
 * Uses timeout to signal the user command before walltime expires,
 * tracks total elapsed time across segments, and auto-resubmits
 * if total requested time hasn't been reached.
 */
export function generateCheckpointScript(opts: TemplateOptions): string {
  const totalTimeSeconds = opts.totalTimeSeconds ?? 86400;
  const walltimeSeconds = opts.walltimeSeconds ?? 10740; // ~2:59:00
  const bufferSeconds = opts.bufferSeconds ?? 600;

  const lines: string[] = [];

  lines.push(generatePreamble(opts));

  lines.push(`# Checkpoint-restart tracking`);
  lines.push(`RV_SEGMENT_START=$(date +%s)`);
  lines.push(`RV_TOTAL_ELAPSED=\${RV_TOTAL_ELAPSED:-0}`);
  lines.push(`RV_TOTAL_REQUESTED=${totalTimeSeconds}`);
  lines.push("");

  lines.push(`BUFFER_SECONDS=${bufferSeconds}`);
  lines.push(`# Detect actual walltime (may differ when --time-min is used)`);
  lines.push(`if [ -n "$SLURM_JOB_END_TIME" ]; then`);
  lines.push(`  WALLTIME_SECONDS=$(( SLURM_JOB_END_TIME - $(date +%s) ))`);
  lines.push(`else`);
  lines.push(`  WALLTIME_SECONDS=${walltimeSeconds}`);
  lines.push(`fi`);
  lines.push(`TIMEOUT=$((WALLTIME_SECONDS - BUFFER_SECONDS))`);
  lines.push(`if [ $TIMEOUT -lt 60 ]; then`);
  lines.push(
    `  echo "rv: walltime too short for checkpoint (${bufferSeconds}s buffer > walltime)" >&2`,
  );
  lines.push(`  TIMEOUT=60`);
  lines.push(`fi`);
  lines.push("");

  // Run with timeout
  lines.push(`# Run command with timeout (sends SIGUSR1 before walltime)`);
  lines.push(`timeout --signal=SIGUSR1 \${TIMEOUT}s ${opts.command}`);
  lines.push(`EXIT_CODE=$?`);
  lines.push("");

  // Calculate elapsed and decide whether to resubmit
  lines.push(`# Check if we need to resubmit`);
  lines.push(`SEGMENT_ELAPSED=$(( $(date +%s) - RV_SEGMENT_START ))`);
  lines.push(`NEW_TOTAL=$(( RV_TOTAL_ELAPSED + SEGMENT_ELAPSED ))`);
  lines.push("");

  lines.push(
    `if [ $EXIT_CODE -ne 0 ] && [ $NEW_TOTAL -lt $RV_TOTAL_REQUESTED ]; then`,
  );
  lines.push(`  export RV_TOTAL_ELAPSED=$NEW_TOTAL`);
  lines.push(`  sbatch --export=ALL,RV_TOTAL_ELAPSED=$NEW_TOTAL $0`);
  if (opts.notifyUrl) {
    lines.push(`  _rv_notify RESUBMITTED`);
  }
  lines.push(`else`);
  if (opts.notifyUrl) {
    lines.push(`  if [ $EXIT_CODE -ne 0 ]; then`);
    lines.push(`    _rv_notify FAILED`);
    lines.push(`  else`);
    lines.push(`    _rv_notify COMPLETED`);
    lines.push(`  fi`);
  }
  lines.push(`  exit $EXIT_CODE`);
  lines.push(`fi`);

  return lines.join("\n");
}
