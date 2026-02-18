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
