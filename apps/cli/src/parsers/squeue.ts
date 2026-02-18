import type { Job, JobState } from "@rivanna/shared";

const VALID_STATES = new Set<JobState>([
  "RUNNING",
  "PENDING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMEOUT",
  "NODE_FAIL",
  "PREEMPTED",
  "SUSPENDED",
]);

/**
 * Parse a Slurm time string to seconds.
 * Handles: MM:SS, HH:MM:SS, D-HH:MM:SS, UNLIMITED, INVALID
 */
export function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr || timeStr === "UNLIMITED" || timeStr === "INVALID") return 0;

  const dayMatch = timeStr.match(/^(\d+)-(\d+):(\d+):(\d+)$/);
  if (dayMatch) {
    const [, d, h, m, s] = dayMatch;
    return Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s);
  }

  const hmsMatch = timeStr.match(/^(\d+):(\d+):(\d+)$/);
  if (hmsMatch) {
    const [, h, m, s] = hmsMatch;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }

  const msMatch = timeStr.match(/^(\d+):(\d+)$/);
  if (msMatch) {
    const [, m, s] = msMatch;
    return Number(m) * 60 + Number(s);
  }

  return 0;
}

/**
 * Expand a Slurm nodelist like "udc-an38-[1,3,5-7]" into individual nodes.
 */
function expandNodeList(nodeList: string): string[] {
  if (!nodeList || nodeList === "(None)") return [];

  // Simple case: single node with no brackets
  if (!nodeList.includes("[")) return [nodeList];

  const match = nodeList.match(/^(.+)\[(.+)\]$/);
  if (!match) return [nodeList];

  const [, prefix, rangeStr] = match;
  const nodes: string[] = [];

  for (const part of rangeStr!.split(",")) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const padLen = range[1]!.length;
      for (let i = start; i <= end; i++) {
        nodes.push(`${prefix}${String(i).padStart(padLen, "0")}`);
      }
    } else {
      nodes.push(`${prefix}${part}`);
    }
  }

  return nodes;
}

function parseJobState(raw: string): JobState {
  const upper = raw.toUpperCase();
  return VALID_STATES.has(upper as JobState) ? (upper as JobState) : "UNKNOWN";
}

/**
 * Parse squeue output.
 * Expected format: `squeue -o "%i %j %T %M %l %P %b %N %R" --noheader`
 * Fields: JOBID NAME STATE TIME TIME_LIMIT PARTITION TRES_PER_NODE NODELIST REASON
 *
 * Note: REASON field can contain spaces, so we split on whitespace with a limit.
 */
export function parseSqueue(output: string): Job[] {
  const jobs: Job[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Split into at most 9 parts (REASON can contain spaces)
    const parts = trimmed.split(/\s+/);
    if (parts.length < 8) continue;

    const [id, name, stateRaw, elapsed, limit, partition, gres, nodeList] =
      parts;
    const reason = parts.slice(8).join(" ") || "";

    jobs.push({
      id: id!,
      name: name!,
      user: "", // squeue format doesn't include user in our format
      state: parseJobState(stateRaw!),
      partition: partition!,
      gres: gres === "(null)" ? "" : gres!,
      timeElapsed: elapsed!,
      timeElapsedSeconds: parseTimeToSeconds(elapsed!),
      timeLimit: limit!,
      timeLimitSeconds: parseTimeToSeconds(limit!),
      nodes: expandNodeList(nodeList!),
      reason: reason.replace(/^\(|\)$/g, ""),
    });
  }

  return jobs;
}
