import { existsSync, readFileSync, writeFileSync } from "fs";
import type { RvConfig } from "@rivanna/shared";
import { SSHClient } from "@/core/ssh.ts";
import { SlurmClient } from "@/core/slurm.ts";
import { ensureInitialized } from "@/core/config.ts";
import { KEEPALIVE_FILE } from "@/lib/constants.ts";

/** How often to touch scratch files (24 hours). */
const KEEPALIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function ensureSetup(): {
  config: RvConfig;
  ssh: SSHClient;
  slurm: SlurmClient;
} {
  const config = ensureInitialized();
  const ssh = SSHClient.fromConfig(config);
  const slurm = new SlurmClient(
    ssh,
    config.connection.user,
    config.defaults.account,
  );

  if (config.scratch_keepalive?.enabled !== false) {
    maybeKeepalive(ssh, config);
  }

  return { config, ssh, slurm };
}

/**
 * Touch all files under ~/.rv and cache dirs on scratch to prevent
 * the 90-day purge policy from deleting them. Runs at most once per day,
 * non-blocking (fire-and-forget).
 */
function maybeKeepalive(ssh: SSHClient, config: RvConfig): void {
  try {
    if (existsSync(KEEPALIVE_FILE)) {
      const last = parseInt(readFileSync(KEEPALIVE_FILE, "utf-8").trim(), 10);
      if (Date.now() - last < KEEPALIVE_INTERVAL_MS) return;
    }
  } catch {
    // corrupt file or read error — proceed with keepalive
  }

  // Write timestamp immediately so concurrent commands don't duplicate
  writeFileSync(KEEPALIVE_FILE, String(Date.now()));

  const scratch = config.paths.scratch;
  const dirs = [
    `${scratch}/.rv`,
    `${scratch}/.cache/uv`,
    `${scratch}/.cache/pip`,
    `${scratch}/.cache/huggingface`,
  ];

  // Fire-and-forget: touch all files in critical directories
  const cmd = dirs
    .map((d) => `find ${d} -exec touch -a {} + 2>/dev/null`)
    .join("; ");

  ssh.exec(cmd, { timeoutMs: 120_000 }).catch(() => {
    // Keepalive is best-effort — don't fail the user's command
  });
}

/**
 * Parse user-friendly time strings into seconds and Slurm format.
 *
 * Accepts: "2h", "24h", "3d", "2:59", "02:59:00", "1-00:00:00"
 */
export function parseTime(input: string): {
  seconds: number;
  formatted: string;
} {
  // Already Slurm format: D-HH:MM:SS or HH:MM:SS or MM:SS
  if (input.includes(":") || input.includes("-")) {
    const seconds = slurmTimeToSeconds(input);
    return { seconds, formatted: secondsToSlurm(seconds) };
  }

  // Shorthand: 2h, 24h, 3d, 30m
  const match = input.match(/^(\d+(?:\.\d+)?)\s*(m|h|d)$/i);
  if (match) {
    const value = parseFloat(match[1]!);
    const unit = match[2]!.toLowerCase();
    let seconds: number;
    if (unit === "m") seconds = Math.round(value * 60);
    else if (unit === "h") seconds = Math.round(value * 3600);
    else seconds = Math.round(value * 86400);
    return { seconds, formatted: secondsToSlurm(seconds) };
  }

  throw new Error(
    `Invalid time format: "${input}". Use 2h, 24h, 3d, or HH:MM:SS.`,
  );
}

function slurmTimeToSeconds(time: string): number {
  // D-HH:MM:SS
  const dayMatch = time.match(/^(\d+)-(\d+):(\d+):(\d+)$/);
  if (dayMatch) {
    return (
      parseInt(dayMatch[1]!) * 86400 +
      parseInt(dayMatch[2]!) * 3600 +
      parseInt(dayMatch[3]!) * 60 +
      parseInt(dayMatch[4]!)
    );
  }

  // HH:MM:SS
  const hmsMatch = time.match(/^(\d+):(\d+):(\d+)$/);
  if (hmsMatch) {
    return (
      parseInt(hmsMatch[1]!) * 3600 +
      parseInt(hmsMatch[2]!) * 60 +
      parseInt(hmsMatch[3]!)
    );
  }

  // MM:SS
  const msMatch = time.match(/^(\d+):(\d+)$/);
  if (msMatch) {
    return parseInt(msMatch[1]!) * 60 + parseInt(msMatch[2]!);
  }

  throw new Error(`Cannot parse time: "${time}"`);
}

function secondsToSlurm(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hms = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return days > 0 ? `${days}-${hms}` : hms;
}
