import type { TemplateOptions } from "@rivanna/shared";
import { generatePreamble, generateEpilogue } from "./base.ts";

/**
 * Generate a simple single-node Slurm batch script.
 */
export function generateSimpleScript(opts: TemplateOptions): string {
  const lines: string[] = [];

  lines.push(generatePreamble(opts));
  lines.push(`# Run command`);
  lines.push(opts.command);
  lines.push(generateEpilogue(opts));

  return lines.join("\n");
}
