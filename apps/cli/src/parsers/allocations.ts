import type { SUBalance, SUAccount } from "@rivanna/shared";

/**
 * Parse UVA `allocations` command output into SUBalance.
 *
 * Real output format:
 *   Account                      Balance        Reserved       Available
 *   -----------------          ---------       ---------       ---------
 *   meng-lab                    10000000               0         8742210
 *
 * Balance = total allocated SUs
 * Available = remaining usable SUs
 * Used = Balance - Available
 */
export function parseAllocations(output: string): SUBalance {
  const accounts: SUAccount[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip header, separator, and info lines
    if (
      trimmed.startsWith("Account") ||
      trimmed.startsWith("---") ||
      trimmed.startsWith("for more") ||
      trimmed.startsWith("run:")
    ) {
      continue;
    }

    // Match: account_name  balance  reserved  available
    const match = trimmed.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (!match) continue;

    const [, name, balance, , available] = match;
    const balanceSU = Number(balance);
    const availableSU = Number(available);

    accounts.push({
      name: name!,
      balanceSU: availableSU,
      usedSU: balanceSU - availableSU,
    });
  }

  return { accounts };
}
