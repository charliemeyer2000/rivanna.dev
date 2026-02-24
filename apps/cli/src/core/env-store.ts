import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { ENV_FILE, RV_DIR } from "@/lib/constants.ts";

interface EnvStore {
  vars: Record<string, string>;
}

export function loadEnvStore(): EnvStore {
  if (!existsSync(ENV_FILE)) return { vars: {} };
  try {
    const raw = readFileSync(ENV_FILE, "utf-8");
    return JSON.parse(raw) as EnvStore;
  } catch {
    return { vars: {} };
  }
}

function saveEnvStore(store: EnvStore): void {
  if (!existsSync(RV_DIR)) {
    mkdirSync(RV_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(ENV_FILE, JSON.stringify(store, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function setEnvVar(key: string, value: string): void {
  const store = loadEnvStore();
  store.vars[key] = value;
  saveEnvStore(store);
}

export function removeEnvVar(key: string): boolean {
  const store = loadEnvStore();
  if (!(key in store.vars)) return false;
  delete store.vars[key];
  saveEnvStore(store);
  return true;
}

export function getAllEnvVars(): Record<string, string> {
  return loadEnvStore().vars;
}

/**
 * Parse a .env file's contents into key-value pairs.
 * Supports: KEY=VALUE, KEY="VALUE", KEY='VALUE', export KEY=VALUE.
 * Skips blank lines, comments (#), and lines without a valid assignment.
 */
export function parseDotEnv(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const stripped = line.startsWith("export ") ? line.slice(7) : line;

    const eqIdx = stripped.indexOf("=");
    if (eqIdx < 1) continue;

    const key = stripped.slice(0, eqIdx).trim();
    let value = stripped.slice(eqIdx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    const commentIdx = value.indexOf(" #");
    if (commentIdx >= 0) {
      value = value.slice(0, commentIdx).trimEnd();
    }

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      vars[key] = value;
    }
  }
  return vars;
}

/**
 * Import all key-value pairs from a parsed env map into the store.
 * Returns the list of keys that were set.
 */
export function importEnvVars(vars: Record<string, string>): string[] {
  const store = loadEnvStore();
  const keys: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    store.vars[key] = value;
    keys.push(key);
  }
  saveEnvStore(store);
  return keys;
}
