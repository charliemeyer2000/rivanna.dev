/**
 * Detect CUDA/GPU hardware failures and decide whether to auto-retry
 * with node exclusion.
 */

const HARDWARE_ERROR_PATTERNS = [
  /CUDA error: unknown error/i,
  /Failed to get device handle/i,
  /cudaErrorUnknown/i,
  /GPU has fallen off the bus/i,
  /uncorrectable ECC error/i,
  /NCCL.*unhandled system error/i,
  /NVMLError_Unknown/,
];

const MAX_RETRIES = 2;
const MAX_ELAPSED_SECONDS = 120;

export interface RetryDecision {
  shouldRetry: boolean;
  reason?: string;
  excludeNodes?: string;
}

/**
 * Analyze a job's stderr for hardware errors and decide if retrying
 * on different nodes would help.
 *
 * Only retries when:
 * - Job failed within the first 120 seconds (fast failure = likely hardware)
 * - Error log matches known CUDA/GPU hardware patterns
 * - Retry count hasn't exceeded MAX_RETRIES
 */
export function analyzeForHardwareRetry(
  errLog: string,
  failedNodes: string[],
  elapsedSeconds: number,
  retryCount: number,
  currentExcludeNodes?: string,
): RetryDecision {
  if (retryCount >= MAX_RETRIES) {
    return { shouldRetry: false };
  }
  if (elapsedSeconds > MAX_ELAPSED_SECONDS) {
    return { shouldRetry: false };
  }
  if (failedNodes.length === 0) {
    return { shouldRetry: false };
  }

  const matchedPattern = HARDWARE_ERROR_PATTERNS.find((p) => p.test(errLog));
  if (!matchedPattern) {
    return { shouldRetry: false };
  }

  // Combine with existing exclusions
  const existingNodes = currentExcludeNodes
    ? currentExcludeNodes.split(",")
    : [];
  const allExcluded = [...new Set([...existingNodes, ...failedNodes])];

  return {
    shouldRetry: true,
    reason: `Hardware error detected (${matchedPattern.source})`,
    excludeNodes: allExcluded.join(","),
  };
}
