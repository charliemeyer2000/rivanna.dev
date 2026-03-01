import type { Command } from "commander";
import ora from "ora";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";

interface GpuOptions {
  json?: boolean;
  node?: string;
}

export function registerGpuCommand(program: Command) {
  program
    .command("gpu")
    .description("Show GPU utilization for a running job")
    .argument("[jobId]", "job ID (defaults to most recent running job)")
    .option("--json", "output as JSON")
    .option("--node <index>", "node index for multi-node jobs (default: all)")
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

  const spinner = isJson ? null : ora("Finding job...").start();
  const jobs = await slurm.getJobs();
  spinner?.stop();

  let job;

  if (!jobId) {
    job = jobs.find(
      (j) =>
        j.state === "RUNNING" ||
        j.state === "CONFIGURING" ||
        j.state === "COMPLETING",
    );
    if (!job) {
      throw new Error("No running jobs found. Specify a job ID.");
    }
    jobId = job.id;
  } else {
    job = jobs.find((j) => j.id === jobId);
  }

  if (!job || job.nodes.length === 0) {
    throw new Error(`Job ${jobId} not found or not yet allocated to a node.`);
  }

  if (!isJson) {
    console.log(theme.muted(`  Job ${job.id}: ${job.name}`));
    console.log(theme.muted(`  ${job.gres} on ${job.nodes.join(", ")}\n`));
  }

  const nodeIdx =
    options.node !== undefined ? parseInt(options.node, 10) : undefined;

  if (nodeIdx !== undefined) {
    if (nodeIdx < 0 || nodeIdx >= job.nodes.length) {
      throw new Error(
        `Node index ${nodeIdx} out of range. Job has ${job.nodes.length} node(s): ${job.nodes.join(", ")}`,
      );
    }
  }

  const isMultiNode = job.nodes.length > 1;

  if (isMultiNode && nodeIdx === undefined && !isJson) {
    console.log(
      theme.muted(
        `  Job spans ${job.nodes.length} nodes (use --node N for a specific node)\n`,
      ),
    );
  }

  const targets =
    nodeIdx !== undefined
      ? [{ index: nodeIdx, name: job.nodes[nodeIdx]! }]
      : job.nodes.map((name, i) => ({ index: i, name }));

  const jsonResults: Array<{ node: number; nodeName: string; output: string }> =
    [];

  for (const { index, name } of targets) {
    if (isMultiNode && !isJson) {
      console.log(theme.accent(`--- node ${index}: ${name} ---`));
    }

    const cmd = `srun --jobid=${jobId} --overlap --nodelist=${name} env -u CUDA_VISIBLE_DEVICES nvidia-smi`;
    const output = await slurm.sshClient.exec(cmd);

    if (isJson) {
      jsonResults.push({ node: index, nodeName: name, output });
    } else {
      process.stdout.write(output);
      if (!output.endsWith("\n")) process.stdout.write("\n");
    }
  }

  if (isJson) {
    if (isMultiNode) {
      console.log(JSON.stringify({ jobId, nodes: jsonResults }));
    } else {
      console.log(
        JSON.stringify({ jobId, output: jsonResults[0]?.output ?? "" }),
      );
    }
  }
}
