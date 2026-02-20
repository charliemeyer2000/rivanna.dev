import { readFileSync } from "fs";
import { extname } from "path";

export interface PreflightWarning {
  message: string;
}

/**
 * Lint a training script for common multi-node issues before submission.
 * Returns warnings (never blocks submission).
 */
export function lintForMultiNode(filePath: string): PreflightWarning[] {
  const ext = extname(filePath).toLowerCase();
  if (ext !== ".py") return [];

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const warnings: PreflightWarning[] = [];

  // Check for init_process_group("nccl") — reminder that CPU tensor collectives
  // (e.g. hostname all_gather) require tensors on GPU with NCCL backend.
  const hasNcclOnly =
    /init_process_group\s*\(\s*["']nccl["']\s*\)/.test(content) ||
    /init_process_group\s*\(\s*backend\s*=\s*["']nccl["']\s*\)/.test(content);
  const hasGloo = /gloo/.test(content);

  if (hasNcclOnly && !hasGloo) {
    warnings.push({
      message:
        'init_process_group("nccl") requires all collective tensors on GPU. ' +
        "Ensure any hostname/CPU tensor all_gather uses .to(device) first.",
    });
  }

  return warnings;
}
