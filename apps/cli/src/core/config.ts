import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { z } from "zod";
import type { RvConfig } from "@rivanna/shared";
import { RV_DIR, CONFIG_FILE } from "@/lib/constants.ts";
import { ConfigError, NotInitializedError } from "@/lib/errors.ts";

export const RvConfigSchema = z.object({
  connection: z.object({
    host: z.string(),
    user: z.string(),
    hostname: z.string(),
  }),
  defaults: z.object({
    account: z.string(),
    gpu_type: z.string().default("any"),
    time: z.string().default("2:59:00"),
    partition: z.string().default("gpu"),
    ai_naming: z.boolean().optional(),
  }),
  paths: z.object({
    scratch: z.string(),
    home: z.string(),
  }),
  notifications: z.object({
    enabled: z.boolean().default(false),
    email: z.string().default(""),
    token: z.string().optional(),
  }),
});

export function loadConfig(): RvConfig | null {
  if (!existsSync(CONFIG_FILE)) {
    return null;
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = parseTOML(raw);
    return RvConfigSchema.parse(parsed) as RvConfig;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ConfigError(
        `Invalid config at ${CONFIG_FILE}: ${error.issues.map((i) => i.message).join(", ")}`,
      );
    }
    throw new ConfigError(`Failed to read config: ${error}`);
  }
}

export function saveConfig(config: RvConfig): void {
  const validated = RvConfigSchema.parse(config);

  if (!existsSync(RV_DIR)) {
    mkdirSync(RV_DIR, { recursive: true, mode: 0o700 });
  }

  const toml = stringifyTOML(validated);
  writeFileSync(CONFIG_FILE, toml, { mode: 0o600 });
}

export function ensureInitialized(): RvConfig {
  const config = loadConfig();
  if (!config) {
    throw new NotInitializedError();
  }
  return config;
}
