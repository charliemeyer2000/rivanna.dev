import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { Command } from "commander";
import {
  setEnvVar,
  removeEnvVar,
  getAllEnvVars,
  parseDotEnv,
  importEnvVars,
} from "@/core/env-store.ts";
import { theme } from "@/lib/theme.ts";

const SENSITIVE_PATTERNS = ["KEY", "TOKEN", "SECRET", "PASSWORD"];

function maskValue(key: string, value: string): string {
  const isSensitive = SENSITIVE_PATTERNS.some((p) =>
    key.toUpperCase().includes(p),
  );
  if (!isSensitive || value.length <= 4) return value;
  return value.slice(0, 4) + "****";
}

export function registerEnvCommand(program: Command) {
  const env = program
    .command("env")
    .description("Manage environment variables for Rivanna jobs");

  env
    .command("set")
    .description("Set an environment variable")
    .argument("<key>", "variable name")
    .argument("<value>", "variable value")
    .action(async (key: string, value: string) => {
      try {
        setEnvVar(key, value);
        console.log(theme.success(`Set ${key}=${maskValue(key, value)}`));
      } catch (error) {
        if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });

  env
    .command("list")
    .description("List all environment variables")
    .option("--json", "output as JSON")
    .action(async (options: { json?: boolean }) => {
      const vars = getAllEnvVars();
      const entries = Object.entries(vars);

      if (options.json) {
        console.log(JSON.stringify(vars, null, 2));
        return;
      }

      if (entries.length === 0) {
        console.log(theme.muted("\nNo environment variables set."));
        console.log(theme.muted('  Use "rv env set KEY VALUE" to add one.'));
        return;
      }

      console.log(theme.info("\nEnvironment variables:"));
      for (const [key, value] of entries) {
        console.log(`  ${key}=${maskValue(key, value)}`);
      }
      console.log();
    });

  env
    .command("rm")
    .description("Remove an environment variable")
    .argument("<key>", "variable name to remove")
    .action(async (key: string) => {
      const removed = removeEnvVar(key);
      if (removed) {
        console.log(theme.success(`Removed ${key}`));
      } else {
        console.log(theme.muted(`${key} not found.`));
      }
    });

  env
    .command("import")
    .description("Import variables from a .env file")
    .argument("[file]", "path to .env file", ".env")
    .action(async (file: string) => {
      try {
        const filePath = resolve(file);
        if (!existsSync(filePath)) {
          console.error(theme.error(`\nFile not found: ${file}`));
          process.exit(1);
        }

        const content = readFileSync(filePath, "utf-8");
        const vars = parseDotEnv(content);

        if (Object.keys(vars).length === 0) {
          console.log(theme.muted(`\nNo variables found in ${file}.`));
          return;
        }

        const keys = importEnvVars(vars);
        console.log(
          theme.success(
            `\nImported ${keys.length} variable${keys.length === 1 ? "" : "s"} from ${file}:`,
          ),
        );
        for (const key of keys) {
          console.log(`  ${key}=${maskValue(key, vars[key]!)}`);
        }
        console.log();
      } catch (error) {
        if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}
