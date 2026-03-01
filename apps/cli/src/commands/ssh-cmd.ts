import type { Command } from "commander";
import ora from "ora";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";

interface SshOptions {
  config?: boolean;
  node?: string;
}

export function registerSshCommand(program: Command) {
  program
    .command("ssh")
    .description("Attach to a running job's compute node")
    .argument("[jobId]", "job to connect to (default: most recent running)")
    .option("--config", "print SSH config entry for VS Code / Cursor")
    .option("--node <index>", "node index for multi-node jobs (default: 0)")
    .action(async (jobId: string | undefined, options: SshOptions) => {
      try {
        await runSsh(jobId, options);
      } catch (error) {
        if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

async function runSsh(jobId: string | undefined, options: SshOptions) {
  const { config, slurm } = ensureSetup();

  let targetJobId = jobId;

  if (!targetJobId) {
    const spinner = ora("Finding running jobs...").start();
    const jobs = await slurm.getJobs();
    spinner.stop();

    const running = jobs.filter((j) => j.state === "RUNNING");
    if (running.length === 0) {
      console.error(theme.error("\nNo running jobs to connect to."));
      const pending = jobs.filter((j) => j.state === "PENDING");
      if (pending.length > 0) {
        console.error(
          theme.muted(
            `  ${pending.length} job(s) pending. Wait for allocation.`,
          ),
        );
      }
      process.exit(1);
    }

    const job = running.sort((a, b) => parseInt(b.id) - parseInt(a.id))[0]!;
    targetJobId = job.id;

    console.log(theme.muted(`Job ${job.id}: ${job.name}`));
    console.log(theme.muted(`  ${job.gres} on ${job.nodes.join(", ")}`));
  } else {
    // Show job context for specified job
    const jobs = await slurm.getJobs();
    const job = jobs.find((j) => j.id === targetJobId);
    if (job) {
      console.log(theme.muted(`Job ${job.id}: ${job.name}`));
      console.log(theme.muted(`  ${job.gres} on ${job.nodes.join(", ")}`));
    }
  }

  // Get node for this job
  const jobs = await slurm.getJobs();
  const job = jobs.find((j) => j.id === targetJobId);
  if (!job || job.nodes.length === 0) {
    throw new Error(
      `Job ${targetJobId} not found or not yet allocated to a node.`,
    );
  }
  const nodeIdx = options.node ? parseInt(options.node, 10) : 0;
  if (nodeIdx < 0 || nodeIdx >= job.nodes.length) {
    throw new Error(
      `Node index ${nodeIdx} out of range. Job has ${job.nodes.length} node(s): ${job.nodes.join(", ")}`,
    );
  }
  const node = job.nodes[nodeIdx]!;
  if (job.nodes.length > 1 && !options.node) {
    console.log(
      theme.muted(
        `  Job spans ${job.nodes.length} nodes: ${job.nodes.join(", ")}`,
      ),
    );
    console.log(
      theme.muted(`  Connecting to ${node} (use --node N for others)`),
    );
  }

  if (options.config) {
    // Print SSH config entry for VS Code / Cursor
    console.log(theme.info("\nAdd to ~/.ssh/config:\n"));
    console.log(`Host rv-compute`);
    console.log(`    HostName ${node}`);
    console.log(`    ProxyJump ${config.connection.host}`);
    console.log(`    User ${config.connection.user}`);
    console.log();
    return;
  }

  // Inject environment variables for the compute session
  const user = config.connection.user;
  const ckptDir = `/scratch/${user}/.rv/checkpoints/${job.name}`;
  const hfHome =
    config.shared?.hf_cache ?? `/scratch/${user}/.cache/huggingface`;
  const envExports = [
    `RV_CHECKPOINT_DIR=${ckptDir}`,
    `HF_HOME=${hfHome}`,
    `UV_CACHE_DIR=/scratch/${user}/.cache/uv`,
    `PIP_CACHE_DIR=/scratch/${user}/.cache/pip`,
  ].join(",");

  // Attach via srun (compute nodes don't allow direct SSH)
  console.log(theme.muted(`\nConnecting to ${node}...`));
  const exitCode = await slurm.sshClient.execInteractive([
    "ssh",
    "-t",
    config.connection.host,
    `srun --jobid=${targetJobId} --overlap --export=ALL,${envExports} --pty /bin/bash`,
  ]);
  process.exit(exitCode);
}
