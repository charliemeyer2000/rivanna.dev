import type { Command } from "commander";
import type { GPUType } from "@rivanna/shared";
import { GPU_TYPE_ALIASES } from "@/lib/constants.ts";
import { parseTime } from "@/lib/setup.ts";

interface RawGpuOptions {
  gpu: string;
  type?: string;
  time: string;
  mig?: boolean;
}

interface ParsedGpuOptions {
  gpuCount: number;
  gpuType: GPUType | undefined;
  time: { seconds: number; formatted: string };
}

/**
 * Add the standard GPU allocation options to a Commander command.
 * Use `full: false` for cost (no --name, --mem, --mig).
 */
export function addGpuOptions(
  cmd: Command,
  opts: { full: boolean } = { full: true },
): Command {
  cmd
    .option("-g, --gpu <n>", "number of GPUs", "1")
    .option("-t, --type <type>", "GPU type")
    .option("--time <duration>", "total time needed", "2:59:00");

  if (opts.full) {
    cmd
      .option("--name <name>", "job name")
      .option(
        "--mem <size>",
        "total CPU memory (e.g., 200G). Auto-calculated if omitted",
      )
      .option("--mig", "shortcut for --gpu 1 --type mig (free)");
  }

  return cmd;
}

/**
 * Parse the raw GPU options from Commander into typed values.
 * Handles --mig shortcut, GPU type alias resolution, and MIG auto-correct.
 */
export function parseGpuOptions(options: RawGpuOptions): ParsedGpuOptions {
  let gpuCount = parseInt(options.gpu, 10);
  let gpuType: GPUType | undefined;

  if (options.mig) {
    gpuCount = 1;
    gpuType = "mig";
  } else if (options.type) {
    gpuType = GPU_TYPE_ALIASES[options.type.toLowerCase()];
    if (!gpuType) {
      throw new Error(
        `Unknown GPU type: "${options.type}". Valid: ${Object.keys(GPU_TYPE_ALIASES).join(", ")}`,
      );
    }
    // MIG only supports 1 GPU — auto-correct silently
    if (gpuType === "mig") gpuCount = 1;
  }

  const time = parseTime(options.time);

  return { gpuCount, gpuType, time };
}
