import type { Command } from "commander";
import ora from "ora";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";

interface GpuOptions {
  json?: boolean;
}

export function registerGpuCommand(program: Command) {
  program
    .command("gpu")
    .description("Show GPU utilization for a running job")
    .argument("[jobId]", "job ID (defaults to most recent running job)")
    .option("--json", "output as JSON")
    .action(async (jobId: string | undefined, options: GpuOptions) => {
      try {
        await runGpu(jobId, options);
      } catch (error) {
        if (options.json) {
          console.log(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        } else if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

async function runGpu(jobId: string | undefined, options: GpuOptions) {
  const { slurm } = ensureSetup();
  const isJson = !!options.json;

  if (!jobId) {
    const spinner = isJson ? null : ora("Finding running job...").start();
    const jobs = await slurm.getJobs();
    spinner?.stop();

    const running = jobs.find(
      (j) =>
        j.state === "RUNNING" ||
        j.state === "CONFIGURING" ||
        j.state === "COMPLETING",
    );
    if (!running) {
      throw new Error("No running jobs found. Specify a job ID.");
    }
    jobId = running.id;
    if (!isJson) {
      console.log(theme.muted(`  Using job ${jobId} (${running.name})\n`));
    }
  }

  const cmd = `srun --jobid=${jobId} --overlap nvidia-smi`;
  const output = await slurm.sshClient.exec(cmd);

  if (isJson) {
    console.log(JSON.stringify({ jobId, output }));
  } else {
    process.stdout.write(output);
    if (!output.endsWith("\n")) process.stdout.write("\n");
  }
}
