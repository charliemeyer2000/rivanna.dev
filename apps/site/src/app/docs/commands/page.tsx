import { Metadata } from "next";
import { CodeBlock } from "../_components/code-block";

export const metadata: Metadata = {
  title: "commands | rivanna.dev docs",
  description: "full reference for all rv CLI commands",
};

function OptionsTable({
  options,
}: {
  options: { flag: string; description: string; default?: string }[];
}) {
  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-sm border border-gray-200">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="px-3 py-2 border-b border-gray-200 font-medium">
              flag
            </th>
            <th className="px-3 py-2 border-b border-gray-200 font-medium">
              description
            </th>
            <th className="px-3 py-2 border-b border-gray-200 font-medium">
              default
            </th>
          </tr>
        </thead>
        <tbody>
          {options.map((opt) => (
            <tr key={opt.flag} className="border-b border-gray-100">
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                {opt.flag}
              </td>
              <td className="px-3 py-2 text-gray-600">{opt.description}</td>
              <td className="px-3 py-2 text-gray-500 text-xs">
                {opt.default ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CommandSection({
  id,
  name,
  description,
  usage,
  options,
  children,
}: {
  id: string;
  name: string;
  description: string;
  usage: string;
  options?: { flag: string; description: string; default?: string }[];
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className="border border-gray-200 p-4 sm:p-6 space-y-3">
      <h3 className="text-lg font-semibold text-black">{name}</h3>
      <p className="text-sm text-gray-600">{description}</p>
      <CodeBlock>
        <code className="text-sm text-black">{usage}</code>
      </CodeBlock>
      {options && <OptionsTable options={options} />}
      {children}
    </section>
  );
}

export default function CommandsPage() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-semibold mb-4">commands</h2>
        <p className="text-gray-600 mb-6">
          full reference for all rv commands. every command supports{" "}
          <code className="text-orange-accent">--json</code> for scripted
          output.
        </p>
      </section>

      <CommandSection
        id="rv-up"
        name="rv up"
        description="Allocate GPUs on Rivanna and attach an interactive shell. Probes the cluster, generates strategies across all compatible GPU types and partitions, submits them in parallel, and drops you into a shell when the first allocation starts running. Use rv run for batch jobs."
        usage="rv up -g 2 -t a100 --time 8h"
        options={[
          {
            flag: "-g, --gpu <n>",
            description: "number of GPUs",
            default: "1",
          },
          {
            flag: "-t, --type <type>",
            description:
              "GPU type (a100, a6000, a40, h200, v100, rtx3090, mig)",
          },
          {
            flag: "--time <duration>",
            description: "total time needed (e.g. 2h, 24h, 3d)",
            default: "2:59:00",
          },
          {
            flag: "--name <name>",
            description: "job name",
            default: "auto-generated",
          },
          {
            flag: "--mem <size>",
            description: "total CPU memory (e.g. 200G)",
            default: "auto",
          },
          {
            flag: "--mig",
            description: "shortcut for --gpu 1 --type mig (free, instant)",
          },
          {
            flag: "--dry-run",
            description: "show strategies without submitting",
          },
        ]}
      >
        <div className="space-y-2 mt-3">
          <p className="text-xs text-gray-500">more examples:</p>
          <CodeBlock>
            <code className="text-sm text-black">
              rv up --mig
              <span className="text-gray-400"> # free MIG slice, instant</span>
            </code>
          </CodeBlock>
          <CodeBlock>
            <code className="text-sm text-black">
              rv up --dry-run
              <span className="text-gray-400"> # preview strategies</span>
            </code>
          </CodeBlock>
        </div>
      </CommandSection>

      <CommandSection
        id="rv-run"
        name="rv run"
        description="Run a command on Rivanna GPUs. Allocates, syncs local files to a git-aware workspace, creates an immutable snapshot, submits the job, and streams output until completion. Each job runs from its own snapshot, so subsequent runs or syncs won't interfere. Exits with the remote job's exit code on failure. For multi-node jobs (4+ GPUs), runs preflight checks, auto-retries on hardware errors, and produces per-node log files with [node0], [node1] prefixes."
        usage="rv run python train.py"
        options={[
          {
            flag: "-g, --gpu <n>",
            description: "number of GPUs",
            default: "1",
          },
          { flag: "-t, --type <type>", description: "GPU type" },
          {
            flag: "--time <duration>",
            description: "total time needed",
            default: "2:59:00",
          },
          {
            flag: "--name <name>",
            description: "job name",
            default: "auto-generated",
          },
          {
            flag: "--mem <size>",
            description: "total CPU memory",
            default: "auto",
          },
          {
            flag: "--mig",
            description: "shortcut for --gpu 1 --type mig (free)",
          },
        ]}
      >
        <div className="space-y-2 mt-3">
          <p className="text-xs text-gray-500">more examples:</p>
          <CodeBlock>
            <code className="text-sm text-black">
              rv run -g 4 -t a100 python train.py
            </code>
          </CodeBlock>
          <CodeBlock>
            <code className="text-sm text-black">
              rv run -g 4 -t a100 torchrun --nproc_per_node=2 train.py
            </code>
          </CodeBlock>
        </div>
      </CommandSection>

      <CommandSection
        id="rv-ps"
        name="rv ps"
        description="List your jobs on Rivanna. Shows job ID, name, state, GPU type, node, and elapsed time. When multiple allocation strategies are pending for the same request, they are collapsed into a single row. Displays git branch and commit hash when available."
        usage="rv ps"
        options={[
          {
            flag: "-a, --all",
            description: "include completed/failed jobs (last 7 days)",
          },
        ]}
      />

      <CommandSection
        id="rv-stop"
        name="rv stop"
        description="Cancel jobs on Rivanna. Pass a job ID to cancel a specific job, or use --all to cancel everything."
        usage="rv stop 12345"
        options={[
          {
            flag: "-a, --all",
            description: "cancel all your jobs (requires confirmation)",
          },
        ]}
      >
        <div className="space-y-2 mt-3">
          <CodeBlock>
            <code className="text-sm text-black">
              rv stop --all
              <span className="text-gray-400"> # cancel everything</span>
            </code>
          </CodeBlock>
        </div>
      </CommandSection>

      <CommandSection
        id="rv-ssh"
        name="rv ssh"
        description="Attach to a running job's compute node. Defaults to the most recent running job if no ID is given. Use --config to print an SSH config entry for VS Code or Cursor."
        usage="rv ssh"
      >
        <div className="space-y-2 mt-3">
          <CodeBlock>
            <code className="text-sm text-black">
              rv ssh 12345
              <span className="text-gray-400"> # attach to specific job</span>
            </code>
          </CodeBlock>
          <CodeBlock>
            <code className="text-sm text-black">
              rv ssh 12345 --node 1
              <span className="text-gray-400">
                {" "}
                # attach to second node (multi-node jobs)
              </span>
            </code>
          </CodeBlock>
          <CodeBlock>
            <code className="text-sm text-black">
              rv ssh --config
              <span className="text-gray-400">
                {" "}
                # print SSH config for VS Code
              </span>
            </code>
          </CodeBlock>
        </div>
      </CommandSection>

      <CommandSection
        id="rv-logs"
        name="rv logs"
        description="View job output logs. Defaults to the most recent job. Automatically follows output for running jobs."
        usage="rv logs"
        options={[
          { flag: "--err", description: "show stderr instead of stdout" },
          { flag: "--pull", description: "download log files locally" },
          {
            flag: "-f, --follow",
            description: "follow log output",
            default: "auto for running jobs",
          },
          {
            flag: "--node <index>",
            description: "show specific node's output (multi-node jobs)",
          },
        ]}
      >
        <div className="space-y-2 mt-3">
          <CodeBlock>
            <code className="text-sm text-black">
              rv logs 12345 --err
              <span className="text-gray-400"> # view stderr</span>
            </code>
          </CodeBlock>
          <CodeBlock>
            <code className="text-sm text-black">
              rv logs --pull
              <span className="text-gray-400"> # download log files</span>
            </code>
          </CodeBlock>
          <CodeBlock>
            <code className="text-sm text-black">
              rv logs 12345 --node 1
              <span className="text-gray-400">
                {" "}
                # view node 1 output (multi-node)
              </span>
            </code>
          </CodeBlock>
        </div>
      </CommandSection>

      <CommandSection
        id="rv-status"
        name="rv status"
        description="Dashboard showing cluster status: connection health, Slurm account, storage usage, active jobs, port forwards, and GPU availability across all partitions."
        usage="rv status"
      />

      <CommandSection
        id="rv-sync"
        name="rv sync"
        description="Sync files between your machine and Rivanna using rsync. Three subcommands: push, pull, and watch. When run from a git repo without an explicit remote path, automatically targets the current branch's workspace."
        usage="rv sync push"
      >
        <div className="space-y-4 mt-3">
          <div>
            <p className="text-sm font-medium text-black mb-2">sync push</p>
            <p className="text-sm text-gray-600 mb-2">
              push local files to Rivanna. defaults to current directory.
              without a remote path, syncs to the git-aware workspace path.
            </p>
            <CodeBlock>
              <code className="text-sm text-black">
                rv sync push
                <span className="text-gray-400">
                  {" "}
                  # syncs to &#123;project&#125;/&#123;branch&#125;/code
                </span>
              </code>
            </CodeBlock>
            <CodeBlock>
              <code className="text-sm text-black">
                rv sync push ./src /scratch/user/project
                <span className="text-gray-400"> # explicit remote path</span>
              </code>
            </CodeBlock>
          </div>
          <div>
            <p className="text-sm font-medium text-black mb-2">sync pull</p>
            <p className="text-sm text-gray-600 mb-2">
              pull remote files to your machine.
            </p>
            <CodeBlock>
              <code className="text-sm text-black">
                rv sync pull /scratch/user/results ./data
              </code>
            </CodeBlock>
          </div>
          <div>
            <p className="text-sm font-medium text-black mb-2">sync watch</p>
            <p className="text-sm text-gray-600 mb-2">
              watch local directory and auto-push on changes. uses the same
              git-aware default path as push.
            </p>
            <CodeBlock>
              <code className="text-sm text-black">rv sync watch</code>
            </CodeBlock>
          </div>
          <OptionsTable
            options={[
              {
                flag: "--dry-run",
                description: "show what would be synced (push/pull only)",
              },
            ]}
          />
        </div>
      </CommandSection>

      <CommandSection
        id="rv-forward"
        name="rv forward"
        description="Forward ports from a running job to your local machine. Useful for Jupyter, TensorBoard, Ray Dashboard, and other web UIs."
        usage="rv forward 8888"
        options={[
          {
            flag: "--auto",
            description: "auto-detect common ports (Ray, Jupyter, TensorBoard)",
          },
          { flag: "-l, --list", description: "list active forwards" },
          {
            flag: "-s, --stop [port]",
            description: "stop a forward (or all if no port given)",
          },
          {
            flag: "--node <index>",
            description:
              "node index for multi-node jobs (default: 0, the head node)",
          },
        ]}
      >
        <div className="space-y-2 mt-3">
          <CodeBlock>
            <code className="text-sm text-black">
              rv forward --auto
              <span className="text-gray-400"> # detect + forward all</span>
            </code>
          </CodeBlock>
          <CodeBlock>
            <code className="text-sm text-black">
              rv forward --list
              <span className="text-gray-400"> # show active forwards</span>
            </code>
          </CodeBlock>
        </div>
      </CommandSection>

      <CommandSection
        id="rv-env"
        name="rv env"
        description="Manage environment variables that are injected into every job. Useful for API keys, model paths, and other secrets. Sensitive values are masked in display."
        usage="rv env set HF_TOKEN hf_abc123..."
      >
        <div className="space-y-4 mt-3">
          <div>
            <p className="text-sm font-medium text-black mb-2">env set</p>
            <CodeBlock>
              <code className="text-sm text-black">rv env set KEY value</code>
            </CodeBlock>
          </div>
          <div>
            <p className="text-sm font-medium text-black mb-2">env list</p>
            <CodeBlock>
              <code className="text-sm text-black">rv env list</code>
            </CodeBlock>
          </div>
          <div>
            <p className="text-sm font-medium text-black mb-2">env rm</p>
            <CodeBlock>
              <code className="text-sm text-black">rv env rm KEY</code>
            </CodeBlock>
          </div>
        </div>
      </CommandSection>

      <CommandSection
        id="rv-cost"
        name="rv cost"
        description="Estimate SU (Service Unit) cost for a job configuration. Shows cost across all GPU types if no type is specified. MIG is always free."
        usage="rv cost -g 4 -t a100 --time 24h"
        options={[
          {
            flag: "-g, --gpu <n>",
            description: "number of GPUs",
            default: "1",
          },
          { flag: "-t, --type <type>", description: "GPU type" },
          {
            flag: "--time <duration>",
            description: "time duration",
            default: "2:59:00",
          },
        ]}
      />

      <CommandSection
        id="rv-exec"
        name="rv exec"
        description="Run a command on the Rivanna login node (no GPU allocation). Useful for checking SU balance, listing files, or quick remote operations. Accepts both individual arguments and quoted shell strings."
        usage="rv exec allocations"
      >
        <div className="space-y-2 mt-3">
          <CodeBlock>
            <code className="text-sm text-black">rv exec ls /scratch/user</code>
          </CodeBlock>
          <CodeBlock>
            <code className="text-sm text-black">
              rv exec &quot;pip list | grep torch&quot;
            </code>
          </CodeBlock>
        </div>
      </CommandSection>

      <CommandSection
        id="rv-upgrade"
        name="rv upgrade"
        description="Check for a newer version and upgrade the rv CLI in place. Downloads the latest binary via the install script. The CLI also checks for updates automatically once per day."
        usage="rv upgrade"
      />

      <CommandSection
        id="rv-init"
        name="rv init"
        description="Interactive setup wizard. Configures your computing ID, SSH keys, VPN check, Slurm account, and remote environment. Run once after installing."
        usage="rv init"
        options={[
          {
            flag: "--force",
            description: "re-run setup even if already configured",
          },
        ]}
      />
    </div>
  );
}
