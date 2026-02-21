import type { Command } from "commander";
import { GPU_SPECS } from "@rivanna/shared";
import type { GPUType } from "@rivanna/shared";
import { GPU_TYPE_ALIASES } from "@/lib/constants.ts";
import { parseTime } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import { renderTable } from "@/lib/table.ts";

interface CostOptions {
  gpu: string;
  type?: string;
  time: string;
  json?: boolean;
}

export function registerCostCommand(program: Command) {
  program
    .command("cost")
    .description("Estimate SU cost for a job")
    .option("-g, --gpu <n>", "number of GPUs", "1")
    .option("-t, --type <type>", "GPU type")
    .option("--time <duration>", "time duration", "2:59:00")
    .option("--json", "output as JSON")
    .action(async (options: CostOptions) => {
      try {
        await runCost(options);
      } catch (error) {
        if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

async function runCost(options: CostOptions) {
  const gpuCount = parseInt(options.gpu, 10);
  const time = parseTime(options.time);
  const hours = time.seconds / 3600;
  const isJson = !!options.json;

  // Try to fetch balance (optional — works even without setup)
  let balance: number | undefined;
  try {
    const { ensureSetup } = await import("@/lib/setup.ts");
    const { slurm } = ensureSetup();
    const suBalance = await slurm.getSUBalance();
    if (suBalance.accounts.length > 0) {
      balance = suBalance.accounts[0]!.balanceSU;
    }
  } catch {
    // Not initialized or SSH unavailable — skip balance
  }

  if (options.type) {
    // Specific GPU type
    const gpuType = GPU_TYPE_ALIASES[options.type.toLowerCase()];
    if (!gpuType) {
      throw new Error(
        `Unknown GPU type: "${options.type}". Valid: ${Object.keys(GPU_TYPE_ALIASES).join(", ")}`,
      );
    }
    const spec = GPU_SPECS[gpuType];
    const totalSU = spec.suPerGPUHour * gpuCount * hours;

    if (isJson) {
      console.log(
        JSON.stringify(
          {
            gpuType,
            gpuCount,
            hours,
            suPerGPUHour: spec.suPerGPUHour,
            totalSU: Math.round(totalSU),
            balance,
            balanceAfter:
              balance !== undefined ? balance - Math.round(totalSU) : undefined,
          },
          null,
          2,
        ),
      );
      return;
    }

    const suStr =
      totalSU === 0 ? "FREE" : `${Math.round(totalSU).toLocaleString()} SUs`;
    console.log(
      theme.info(
        `\n  ${gpuCount}x ${gpuType.toUpperCase()} for ${time.formatted} = ${suStr}`,
      ),
    );
    if (balance !== undefined) {
      const after = balance - Math.round(totalSU);
      console.log(
        theme.muted(
          `  Balance: ${Math.round(balance).toLocaleString()} → ${Math.round(after).toLocaleString()} SUs`,
        ),
      );
    }
    console.log();
    return;
  }

  // No type specified — show costs for all GPU types
  const rows: {
    gpuType: GPUType;
    suPerHour: number;
    totalSU: number;
  }[] = [];

  for (const [gpuType, spec] of Object.entries(GPU_SPECS)) {
    const totalSU = spec.suPerGPUHour * gpuCount * hours;
    rows.push({
      gpuType: gpuType as GPUType,
      suPerHour: spec.suPerGPUHour,
      totalSU,
    });
  }

  rows.sort((a, b) => a.totalSU - b.totalSU);

  if (isJson) {
    console.log(
      JSON.stringify({ gpuCount, hours, balance, costs: rows }, null, 2),
    );
    return;
  }

  console.log(
    theme.info(`\nEstimated cost: ${gpuCount} GPU(s) for ${time.formatted}`),
  );

  const tableRows = rows.map((row) => {
    const suStr =
      row.totalSU === 0
        ? "FREE"
        : `${Math.round(row.totalSU).toLocaleString()} SUs`;
    return [row.gpuType.toUpperCase(), row.suPerHour.toFixed(0), suStr];
  });

  renderTable({
    headers: ["Type", "SU/GPU-hr", "Total"],
    rows: tableRows,
  });

  if (balance !== undefined) {
    console.log(
      theme.muted(
        `\n  Current balance: ${Math.round(balance).toLocaleString()} SUs`,
      ),
    );
  }
  console.log();
}
