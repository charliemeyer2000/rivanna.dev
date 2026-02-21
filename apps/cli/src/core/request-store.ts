import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type { Job, JobState } from "@rivanna/shared";
import { TERMINAL_STATES } from "@rivanna/shared";
import { REQUESTS_FILE, RV_DIR } from "@/lib/constants.ts";
import type { SlurmClient } from "@/core/slurm.ts";

export interface StrategyRecord {
  jobId: string;
  gpuType: string;
  gpusPerNode: number;
  nodes: number;
  topology: "single-node" | "multi-node";
}

export interface RequestRecord {
  id: string;
  jobName: string;
  command: string | null;
  type: "run" | "up";
  strategies: StrategyRecord[];
  createdAt: string;
  git?: { branch: string; commitHash: string; dirty: boolean };
  snapshotPath?: string;
}

interface RequestStore {
  requests: RequestRecord[];
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function loadStore(): RequestStore {
  if (!existsSync(REQUESTS_FILE)) return { requests: [] };
  try {
    const raw = readFileSync(REQUESTS_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data.requests) ? data : { requests: [] };
  } catch {
    return { requests: [] };
  }
}

function saveStore(store: RequestStore): void {
  if (!existsSync(RV_DIR)) {
    mkdirSync(RV_DIR, { recursive: true, mode: 0o700 });
  }
  // Prune entries older than 7 days
  const cutoff = Date.now() - MAX_AGE_MS;
  store.requests = store.requests.filter(
    (r) => new Date(r.createdAt).getTime() > cutoff,
  );
  writeFileSync(REQUESTS_FILE, JSON.stringify(store, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function saveRequest(record: RequestRecord): void {
  const store = loadStore();
  store.requests.push(record);
  saveStore(store);
}

export function loadRequests(): RequestRecord[] {
  return loadStore().requests;
}

/** Map jobId → parent RequestRecord for O(1) lookup in rv ps. */
export function buildJobIndex(
  requests: RequestRecord[],
): Map<string, RequestRecord> {
  const index = new Map<string, RequestRecord>();
  for (const req of requests) {
    for (const strat of req.strategies) {
      index.set(strat.jobId, req);
    }
  }
  return index;
}

/**
 * One-shot cleanup for fan-out strategies: if any sibling job is
 * RUNNING/CONFIGURING/COMPLETING, cancel all other non-terminal siblings.
 * Accepts the already-fetched jobs array so rv ps pays no extra SSH cost.
 */
export async function reapLosers(
  slurm: SlurmClient,
  jobs: Job[],
): Promise<number> {
  const requests = loadRequests();
  if (requests.length === 0) return 0;

  const stateMap = new Map<string, string>();
  for (const job of jobs) {
    stateMap.set(job.id, job.state);
  }

  const toCancel: string[] = [];

  for (const req of requests) {
    if (req.strategies.length <= 1) continue;

    const hasWinner = req.strategies.some((s) => {
      const state = stateMap.get(s.jobId);
      return (
        state === "RUNNING" || state === "CONFIGURING" || state === "COMPLETING"
      );
    });
    if (!hasWinner) continue;

    for (const s of req.strategies) {
      const state = stateMap.get(s.jobId);
      if (!state) continue;
      if (
        state === "RUNNING" ||
        state === "CONFIGURING" ||
        state === "COMPLETING"
      )
        continue;
      if (TERMINAL_STATES.has(state as JobState)) continue;
      toCancel.push(s.jobId);
    }
  }

  if (toCancel.length > 0) {
    await slurm.cancelJobs(toCancel);
  }

  return toCancel.length;
}
