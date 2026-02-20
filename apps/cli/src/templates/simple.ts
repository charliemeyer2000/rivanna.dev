import type { TemplateOptions } from "@rivanna/shared";
import { generatePreamble, generateEpilogue } from "./base.ts";

const TORCHRUN_RE = /^torchrun\b/;
const TORCH_DIST_RE = /^python\s+-m\s+torch\.distributed\.(launch|run)\b/;

function hasFlag(command: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|=|$)`).test(command);
}

/**
 * Inject --master-port into single-node torchrun commands to avoid
 * port 29500 collisions with other jobs on the same node.
 */
function injectMasterPort(command: string): string {
  const trimmed = command.trim();
  const isTorchrun = TORCHRUN_RE.test(trimmed) || TORCH_DIST_RE.test(trimmed);
  if (!isTorchrun || hasFlag(command, "--master-port")) return command;

  if (TORCHRUN_RE.test(trimmed)) {
    return trimmed.replace(/^torchrun/, `torchrun --master-port=$MASTER_PORT`);
  }
  return trimmed.replace(
    /(python\s+-m\s+torch\.distributed\.\w+)/,
    `$1 --master-port=$MASTER_PORT`,
  );
}

/**
 * Generate a simple single-node Slurm batch script.
 */
export function generateSimpleScript(opts: TemplateOptions): string {
  const lines: string[] = [];

  lines.push(generatePreamble(opts));
  lines.push(`# Run command`);
  lines.push(injectMasterPort(opts.command));
  lines.push(generateEpilogue(opts));

  return lines.join("\n");
}
