import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type { ForwardEntry } from "@rivanna/shared";
import { FORWARDS_FILE, RV_DIR } from "@/lib/constants.ts";

function loadForwards(): ForwardEntry[] {
  if (!existsSync(FORWARDS_FILE)) return [];
  try {
    const raw = readFileSync(FORWARDS_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data.forwards) ? data.forwards : [];
  } catch {
    return [];
  }
}

function saveForwards(forwards: ForwardEntry[]): void {
  if (!existsSync(RV_DIR)) {
    mkdirSync(RV_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(FORWARDS_FILE, JSON.stringify({ forwards }, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function addForward(entry: ForwardEntry): void {
  const forwards = cleanStaleForwards();
  forwards.push(entry);
  saveForwards(forwards);
}

export function removeForward(localPort: number): boolean {
  const forwards = cleanStaleForwards();
  const idx = forwards.findIndex((f) => f.localPort === localPort);
  if (idx === -1) return false;
  forwards.splice(idx, 1);
  saveForwards(forwards);
  return true;
}

/**
 * Prune dead PIDs and return alive forwards.
 * Uses process.kill(pid, 0) — signal 0 checks existence without killing.
 */
export function cleanStaleForwards(): ForwardEntry[] {
  const forwards = loadForwards();
  const alive: ForwardEntry[] = [];
  for (const fwd of forwards) {
    try {
      process.kill(fwd.pid, 0);
      alive.push(fwd);
    } catch {
      // PID doesn't exist — stale entry
    }
  }
  saveForwards(alive);
  return alive;
}
