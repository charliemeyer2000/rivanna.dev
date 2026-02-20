import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { REQUESTS_FILE, RV_DIR } from "@/lib/constants.ts";

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
