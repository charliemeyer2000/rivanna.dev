import type { Job } from "@rivanna/shared";
import type { SlurmClient } from "./slurm.ts";

const RUNNING_STATES = new Set(["RUNNING", "CONFIGURING", "COMPLETING"]);

export interface ResolvedJob {
  jobId: string;
  /** The matched Job from the active queue, or null if only found in history */
  job: Job | null;
  /** All active jobs at time of resolution (callers often need these) */
  jobs: Job[];
}

export interface ResolveOptions {
  /** Only match RUNNING/CONFIGURING/COMPLETING jobs (for default selection when no arg given) */
  activeOnly?: boolean;
  /** Search sacct history for completed jobs if not found in queue (default: false) */
  includeHistory?: boolean;
  /** Verb for error messages, e.g. "forward from", "view logs for" (default: "find") */
  verb?: string;
}

/**
 * Resolve a job ID argument to a concrete job.
 *
 * Handles:
 *   - No argument → most recent running job (falls back to any active, then history)
 *   - Exact ID    → direct match in active queue (then history if includeHistory)
 *   - Partial ID  → prefix match, then suffix match, then substring match
 *   - Ambiguity   → error listing the candidates
 *   - No match    → clear error message
 */
export async function resolveJobId(
  slurm: SlurmClient,
  jobIdArg: string | undefined,
  options: ResolveOptions = {},
): Promise<ResolvedJob> {
  const { activeOnly = false, includeHistory = false, verb = "find" } = options;
  const jobs = await slurm.getJobs();

  // ── No argument: pick most recent ──
  if (!jobIdArg) {
    const running = jobs.filter((j) => RUNNING_STATES.has(j.state));
    const candidates = running.length > 0 ? running : activeOnly ? [] : jobs;

    if (candidates.length > 0) {
      const best = candidates.sort(
        (a, b) => parseInt(b.id) - parseInt(a.id),
      )[0]!;
      return { jobId: best.id, job: best, jobs };
    }

    // Fall back to history
    if (includeHistory) {
      const history = await slurm.getJobHistory("now-1day");
      if (history.length > 0) {
        const best = history.sort(
          (a, b) => parseInt(b.id) - parseInt(a.id),
        )[0]!;
        return { jobId: best.id, job: null, jobs };
      }
    }

    throw new Error(
      activeOnly
        ? `No running jobs to ${verb}.`
        : `No recent jobs found to ${verb}.`,
    );
  }

  // ── Argument provided: resolve ID ──

  // Exact match in active queue
  const exact = jobs.find((j) => j.id === jobIdArg);
  if (exact) return { jobId: exact.id, job: exact, jobs };

  // Partial matching (only for numeric inputs, skip for names)
  if (/^\d+$/.test(jobIdArg)) {
    const match = matchPartialId(jobs, jobIdArg);
    if (match) return { jobId: match.id, job: match, jobs };
  }

  // History fallback for completed jobs
  if (includeHistory) {
    const history = await slurm.getJobHistory("now-7days");
    const histExact = history.find((h) => h.id === jobIdArg);
    if (histExact) return { jobId: histExact.id, job: null, jobs };

    if (/^\d+$/.test(jobIdArg)) {
      const histMatch = matchPartialIdHistory(history, jobIdArg);
      if (histMatch) return { jobId: histMatch, job: null, jobs };
    }
  }

  throw new Error(`Job ${jobIdArg} not found. Run rv ps to see active jobs.`);
}

/**
 * Try prefix → suffix → substring matching against active jobs.
 * Returns the unique match, or throws on ambiguity.
 */
function matchPartialId(jobs: Job[], partial: string): Job | null {
  // Prefix
  const prefixMatches = jobs.filter((j) => j.id.startsWith(partial));
  if (prefixMatches.length === 1) return prefixMatches[0]!;
  if (prefixMatches.length > 1) {
    throw new Error(
      `Ambiguous job ID "${partial}" matches ${prefixMatches.length} jobs: ${prefixMatches.map((j) => j.id).join(", ")}`,
    );
  }

  // Suffix
  const suffixMatches = jobs.filter((j) => j.id.endsWith(partial));
  if (suffixMatches.length === 1) return suffixMatches[0]!;
  if (suffixMatches.length > 1) {
    throw new Error(
      `Ambiguous job ID "${partial}" matches ${suffixMatches.length} jobs: ${suffixMatches.map((j) => j.id).join(", ")}`,
    );
  }

  // Substring
  const subMatches = jobs.filter((j) => j.id.includes(partial));
  if (subMatches.length === 1) return subMatches[0]!;
  if (subMatches.length > 1) {
    throw new Error(
      `Ambiguous job ID "${partial}" matches ${subMatches.length} jobs: ${subMatches.map((j) => j.id).join(", ")}`,
    );
  }

  return null;
}

/** Same as matchPartialId but for JobAccounting (history) records. Returns just the ID. */
function matchPartialIdHistory(
  history: { id: string }[],
  partial: string,
): string | null {
  for (const mode of ["prefix", "suffix", "contains"] as const) {
    const fn =
      mode === "prefix"
        ? (h: { id: string }) => h.id.startsWith(partial)
        : mode === "suffix"
          ? (h: { id: string }) => h.id.endsWith(partial)
          : (h: { id: string }) => h.id.includes(partial);

    const matches = history.filter(fn);
    if (matches.length === 1) return matches[0]!.id;
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous job ID "${partial}" matches ${matches.length} jobs: ${matches.map((h) => h.id).join(", ")}`,
      );
    }
  }
  return null;
}
