import type { StorageQuota } from "@rivanna/shared";

const SIZE_MULTIPLIERS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
  PB: 1024 ** 5,
};

function parseSize(value: string, unit: string): number {
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return 0;
  return Math.round(num * (SIZE_MULTIPLIERS[unit.toUpperCase()] ?? 1));
}

/**
 * Parse UVA `hdquota` command output into StorageQuota[].
 *
 * Real output format:
 *   Storage Type       Location                             Size       Used      Avail  Use%
 *   ------------       --------                             ----       ----      -----  ----
 *   Home Directory     /home/abs6bd                     200.0 GB   100.2 GB    99.8 GB   50%
 *   Scratch            /scratch/abs6bd                   10.0 TB     8.0 KB    10.0 TB    0%
 *   Research Standard  /standard/llm-research            20.0 TB    18.5 TB     1.5 TB   93%
 *
 * Strategy: Use regex to match the data pattern since columns have variable widths
 * and types can be multi-word.
 */
export function parseHdquota(output: string): StorageQuota[] {
  const quotas: StorageQuota[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip header/separator lines
    if (
      trimmed.startsWith("Storage Type") ||
      trimmed.startsWith("---") ||
      trimmed.startsWith("===") ||
      trimmed.startsWith("----")
    ) {
      continue;
    }

    // Match pattern: <type words> <path> <size> <unit> <used> <unit> <avail> <unit> <percent>%
    // The path always starts with /
    const match = trimmed.match(
      /^(.+?)\s+(\/\S+)\s+([\d.]+)\s+(\S+)\s+([\d.]+)\s+(\S+)\s+([\d.]+)\s+(\S+)\s+(\d+)%/,
    );
    if (!match) continue;

    const [
      ,
      type,
      mountPoint,
      sizeVal,
      sizeUnit,
      usedVal,
      usedUnit,
      ,
      ,
      usedPercent,
    ] = match;

    quotas.push({
      type: type!.trim(),
      mountPoint: mountPoint!,
      usedBytes: parseSize(usedVal!, usedUnit!),
      totalBytes: parseSize(sizeVal!, sizeUnit!),
      usedPercent: Number(usedPercent),
    });
  }

  return quotas;
}
