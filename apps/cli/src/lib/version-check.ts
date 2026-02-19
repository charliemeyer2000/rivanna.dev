import { readFileSync, writeFileSync, mkdirSync } from "fs";
import {
  SITE_URL,
  RV_DIR,
  VERSION_CHECK_FILE,
  VERSION_CHECK_INTERVAL_MS,
} from "./constants.ts";
import { theme } from "./theme.ts";

const CURRENT_VERSION: string = require("../../package.json").version;

interface VersionCache {
  lastCheck: number;
}

function loadCache(): VersionCache | null {
  try {
    return JSON.parse(readFileSync(VERSION_CHECK_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveCache(cache: VersionCache): void {
  try {
    mkdirSync(RV_DIR, { recursive: true });
    writeFileSync(VERSION_CHECK_FILE, JSON.stringify(cache));
  } catch {
    // best-effort
  }
}

export function compareVersions(current: string, latest: string): boolean {
  const c = current.split(".").map(Number);
  const l = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(`${SITE_URL}/api/cli/version`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.version ?? null;
  } catch {
    return null;
  }
}

export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}

export async function checkForUpdate(): Promise<void> {
  const cache = loadCache();
  const now = Date.now();

  if (cache && now - cache.lastCheck < VERSION_CHECK_INTERVAL_MS) {
    return;
  }

  const latest = await fetchLatestVersion();
  saveCache({ lastCheck: now });

  if (latest && compareVersions(CURRENT_VERSION, latest)) {
    console.log(
      theme.warning(`\n  Update available: ${CURRENT_VERSION} → ${latest}`),
    );
    console.log(theme.muted(`  Run ${theme.accent("rv upgrade")} to update\n`));
  }
}
