import type { Command } from "commander";
import ora from "ora";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import { WELL_KNOWN_PORTS } from "@/lib/constants.ts";
import {
  addForward,
  removeForward,
  cleanStaleForwards,
} from "@/core/forward-store.ts";

interface ForwardOptions {
  auto?: boolean;
  list?: boolean;
  stop?: string | boolean;
  json?: boolean;
}

export function registerForwardCommand(program: Command) {
  program
    .command("forward")
    .description("Forward ports from a running job")
    .argument("[port]", "port to forward")
    .argument("[jobId]", "job to forward from (default: most recent running)")
    .option("--auto", "auto-detect common ports (Ray, Jupyter, TensorBoard)")
    .option("-l, --list", "list active forwards")
    .option("-s, --stop [port]", "stop a forward (or all if no port)")
    .option("--json", "output as JSON")
    .action(
      async (
        port: string | undefined,
        jobId: string | undefined,
        options: ForwardOptions,
      ) => {
        try {
          await runForward(port, jobId, options);
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
      },
    );
}

async function runForward(
  port: string | undefined,
  jobId: string | undefined,
  options: ForwardOptions,
) {
  // List mode
  if (options.list) {
    const forwards = cleanStaleForwards();
    if (options.json) {
      console.log(JSON.stringify(forwards, null, 2));
      return;
    }
    if (forwards.length === 0) {
      console.log(theme.muted("\nNo active port forwards."));
      return;
    }
    console.log(theme.info("\nActive port forwards:"));
    for (const fwd of forwards) {
      console.log(
        `  localhost:${fwd.localPort} ${theme.muted("→")} ${fwd.node}:${fwd.remotePort} ${theme.muted(`(job ${fwd.jobId}, PID ${fwd.pid})`)}`,
      );
    }
    console.log();
    return;
  }

  // Stop mode
  if (options.stop !== undefined) {
    const forwards = cleanStaleForwards();
    if (typeof options.stop === "string" && options.stop.length > 0) {
      const stopPort = parseInt(options.stop, 10);
      const fwd = forwards.find((f) => f.localPort === stopPort);
      if (fwd) {
        try {
          process.kill(fwd.pid);
        } catch {
          // Already dead
        }
        removeForward(stopPort);
        console.log(theme.success(`Stopped forward on port ${stopPort}.`));
      } else {
        console.log(theme.muted(`No forward found on port ${stopPort}.`));
      }
    } else {
      // Stop all
      for (const fwd of forwards) {
        try {
          process.kill(fwd.pid);
        } catch {
          // Already dead
        }
        removeForward(fwd.localPort);
      }
      console.log(
        forwards.length > 0
          ? theme.success(`Stopped ${forwards.length} forward(s).`)
          : theme.muted("No forwards to stop."),
      );
    }
    return;
  }

  // Forward mode — need SSH setup
  const { config, slurm } = ensureSetup();

  // Resolve job
  let targetJobId = jobId;
  if (!targetJobId) {
    const spinner = ora("Finding running jobs...").start();
    const jobs = await slurm.getJobs();
    spinner.stop();

    const running = jobs.filter((j) => j.state === "RUNNING");
    if (running.length === 0) {
      throw new Error("No running jobs to forward from.");
    }
    targetJobId = running.sort((a, b) => parseInt(b.id) - parseInt(a.id))[0]!
      .id;
  }

  // Get node
  const jobs = await slurm.getJobs();
  const job = jobs.find((j) => j.id === targetJobId);
  if (!job || job.nodes.length === 0) {
    throw new Error(
      `Job ${targetJobId} not found or not yet allocated to a node.`,
    );
  }
  const node = job.nodes[0]!;

  // Auto-detect mode
  if (options.auto) {
    cleanStaleForwards();
    const detected: number[] = [];
    const spinner = ora("Detecting ports...").start();

    for (const [name, p] of Object.entries(WELL_KNOWN_PORTS)) {
      const result = await slurm.sshClient
        .exec(
          `ssh ${node} 'ss -tlnp 2>/dev/null | grep :${p}' 2>/dev/null || true`,
        )
        .catch(() => "");
      if (result.trim().length > 0) {
        detected.push(p);
        spinner.text = `Detected ${name} on port ${p}`;
      }
    }
    spinner.stop();

    if (detected.length === 0) {
      console.log(
        theme.muted(
          "\nNo well-known ports detected. Try specifying a port manually.",
        ),
      );
      return;
    }

    for (const p of detected) {
      await createTunnel(config.connection.host, node, p, p, targetJobId);
    }
    return;
  }

  // Single port forward
  if (!port) {
    throw new Error(
      'Specify a port to forward, or use --auto. See "rv forward --help".',
    );
  }

  cleanStaleForwards();
  const localPort = parseInt(port, 10);
  const remotePort = localPort;

  await createTunnel(
    config.connection.host,
    node,
    localPort,
    remotePort,
    targetJobId,
  );
}

async function createTunnel(
  host: string,
  node: string,
  localPort: number,
  remotePort: number,
  jobId: string,
): Promise<void> {
  // ssh -f -N -L backgrounds itself after auth
  const proc = Bun.spawn(
    ["ssh", "-f", "-N", "-L", `${localPort}:${node}:${remotePort}`, host],
    { stdout: "ignore", stderr: "pipe" },
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `Failed to create tunnel: ${stderr.trim() || `exit code ${exitCode}`}`,
    );
  }

  // ssh -f forks into background — find the PID via lsof on the local port
  await new Promise((r) => setTimeout(r, 500)); // brief wait for ssh to bind
  const lsofResult = Bun.spawnSync(
    ["lsof", "-ti", `:${localPort}`, "-sTCP:LISTEN"],
    { stdout: "pipe" },
  );
  const pidStr = new TextDecoder()
    .decode(lsofResult.stdout)
    .trim()
    .split("\n")[0];
  const pid = pidStr ? parseInt(pidStr, 10) : 0;

  if (pid > 0) {
    addForward({
      pid,
      jobId,
      localPort,
      remotePort,
      node,
      startedAt: new Date().toISOString(),
    });
  }

  console.log(
    theme.success(`Forwarding localhost:${localPort} → ${node}:${remotePort}`),
  );
}
