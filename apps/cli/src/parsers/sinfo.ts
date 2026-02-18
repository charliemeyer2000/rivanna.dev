import type { NodeState } from "@rivanna/shared";

type SlurmNodeState = NodeState["state"];

const STATE_MAP: Record<string, SlurmNodeState> = {
  IDLE: "idle",
  MIXED: "mixed",
  "MIXED-": "mixed",
  ALLOCATED: "allocated",
  DRAINING: "draining",
  DRAINED: "drained",
  DOWN: "down",
  COMPLETING: "allocated",
  PLANNED: "allocated",
  INVAL: "down",
  RESERVED: "allocated",
};

function mapState(raw: string): SlurmNodeState {
  // Strip suffixes like *, ~, #, $, @
  const cleaned = raw.replace(/[*~#$@]+$/, "").toUpperCase();
  return STATE_MAP[cleaned] ?? "unknown";
}

function parseGres(gres: string): { type: string; total: number } {
  // Handle formats like:
  //   gpu:a6000:8(S:0-47)
  //   gpu:a100:8
  //   gpu:1g.10gb:56
  const match = gres.match(/gpu:([^:]+):(\d+)/);
  if (match) {
    return { type: match[1]!, total: Number(match[2]) };
  }
  return { type: "unknown", total: 0 };
}

function parseCpus(cpuStr: string): { allocated: number; total: number } {
  // Format: A/I/O/T (allocated/idle/other/total)
  const parts = cpuStr.split("/");
  if (parts.length === 4) {
    return {
      allocated: Number(parts[0]),
      total: Number(parts[3]),
    };
  }
  return { allocated: 0, total: 0 };
}

function estimateGpuAllocation(
  state: SlurmNodeState,
  gpuTotal: number,
): number {
  switch (state) {
    case "idle":
      return 0;
    case "allocated":
      return gpuTotal;
    case "mixed":
      return Math.ceil(gpuTotal / 2);
    case "draining":
    case "drained":
    case "down":
      return gpuTotal;
    default:
      return 0;
  }
}

/**
 * Parse sinfo output.
 * Expected format: `sinfo --Node -p <partitions> -o "%N %T %G %C %m" --noheader`
 * Fields: NODELIST STATE GRES CPUS(A/I/O/T) MEMORY
 *
 * Real examples:
 *   udc-an25-20 mixed- gpu:a6000:8(S:0-47) 5/43/0/48 257000
 *   udc-an28-1 mixed- gpu:a100:8(S:16-31,48-63,80-95,112-127) 17/111/0/128 1000000
 *   udc-an37-1 mixed gpu:1g.10gb:56 33/95/0/128 2000000
 *
 * Note: nodes appear once per partition when querying multiple partitions.
 * Caller should deduplicate if needed.
 */
export function parseSinfo(output: string): NodeState[] {
  const nodes: NodeState[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // GRES field can contain parentheses with commas, so split carefully.
    // Fields: NAME STATE GRES CPUS MEMORY
    // GRES may contain (S:0-47) or (S:16-31,48-63,...) — no spaces inside.
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    const name = parts[0]!;
    const stateRaw = parts[1]!;
    // Memory is always last, CPUS is always second to last (A/I/O/T format).
    // GRES is everything between state and CPUS.
    const memStr = parts[parts.length - 1]!;
    const cpuStr = parts[parts.length - 2]!;
    const gresRaw = parts.slice(2, parts.length - 2).join(" ");

    const state = mapState(stateRaw);
    const gres = parseGres(gresRaw);
    const cpus = parseCpus(cpuStr);
    const gpuAllocated = estimateGpuAllocation(state, gres.total);

    nodes.push({
      name,
      state,
      partition: "",
      gpuTotal: gres.total,
      gpuAllocated,
      gpuAvailable: Math.max(0, gres.total - gpuAllocated),
      gresType: gres.type,
      cpuTotal: cpus.total,
      cpuAllocated: cpus.allocated,
      memoryTotalMB: Number(memStr) || 0,
    });
  }

  return nodes;
}
