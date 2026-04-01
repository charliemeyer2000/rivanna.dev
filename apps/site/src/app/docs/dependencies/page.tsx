import { Metadata } from "next";
import { CodeBlock } from "../_components/code-block";

export const metadata: Metadata = {
  title: "dependencies & environment | rivanna.dev docs",
  description:
    "how rv manages Python venvs, dependency installation, torchrun, and common pitfalls",
};

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-orange-accent bg-orange-accent/5 px-4 py-2 text-sm text-gray-700">
      {children}
    </div>
  );
}

export default function DependenciesPage() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-semibold mb-4">
          dependencies &amp; environment
        </h2>
        <p className="text-gray-600 mb-6">
          rv manages Python dependencies and virtual environments automatically.
          this page explains how it works end-to-end and how to avoid common
          pitfalls.
        </p>
      </section>

      {/* ── How the venv works ──────────────────────────────────── */}
      <section
        id="how-the-venv-works"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">how the venv works</h3>
        <p className="text-sm text-gray-600">
          when you run{" "}
          <code className="text-orange-accent">rv run python train.py</code>,
          rv:
        </p>
        <ol className="text-sm text-gray-600 list-decimal pl-5 space-y-1">
          <li>
            <strong className="text-black">syncs</strong> your local project to
            the cluster via rsync (git-tracked files only)
          </li>
          <li>
            <strong className="text-black">creates a persistent venv</strong> at{" "}
            <code className="text-orange-accent">
              /scratch/&#123;user&#125;/.rv/envs/&#123;project&#125;/&#123;branch&#125;/
            </code>{" "}
            if one doesn&apos;t exist
          </li>
          <li>
            <strong className="text-black">installs dependencies</strong> from{" "}
            <code className="text-orange-accent">requirements.txt</code> or{" "}
            <code className="text-orange-accent">pyproject.toml</code> using{" "}
            <code className="text-orange-accent">uv pip install</code>
          </li>
          <li>
            <strong className="text-black">
              creates an immutable snapshot
            </strong>{" "}
            of your code (hardlink copy)
          </li>
          <li>
            <strong className="text-black">generates a SLURM script</strong>{" "}
            that activates the venv,{" "}
            <code className="text-orange-accent">cd</code>s into the snapshot,
            and runs your command
          </li>
        </ol>

        <p className="text-sm text-gray-600 mt-4 mb-2">
          the generated job script looks roughly like this:
        </p>
        <CodeBlock>
          <code className="text-sm text-black whitespace-pre">{`#!/bin/bash
#SBATCH ...

# load Python 3.12 + CUDA
module load cuda/12.8.0 miniforge/24.11.3-py3.12

# activate rv's venv
source /scratch/{user}/.rv/envs/{project}/{branch}/bin/activate

# set environment variables (caches, output dirs, etc.)
export OMP_NUM_THREADS=...
export HF_HOME=...
export RV_OUTPUT_DIR=...
export RV_CHECKPOINT_DIR=...

# cd into the snapshot
cd /scratch/{user}/rv-workspaces/{project}/{branch}/snapshots/{jobName}-{timestamp}/

# run your command
python train.py`}</code>
        </CodeBlock>

        <Tip>
          <strong>
            your command runs inside an activated venv from within the workspace
            snapshot.
          </strong>{" "}
          this means <code className="text-orange-accent">python</code> resolves
          to the venv&apos;s Python 3.12 (not the system&apos;s Python 3.6),{" "}
          <code className="text-orange-accent">torchrun</code>,{" "}
          <code className="text-orange-accent">accelerate</code>,{" "}
          <code className="text-orange-accent">deepspeed</code>, and other entry
          points installed by your dependencies are on PATH, and relative paths
          resolve against the snapshot directory containing your synced project
          files.
        </Tip>
      </section>

      {/* ── Relative paths ─────────────────────────────────────── */}
      <section
        id="relative-paths"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">
          use relative paths for scripts
        </h3>
        <Tip>
          <strong>
            this is the most common mistake agents and users make.
          </strong>
        </Tip>
        <p className="text-sm text-gray-600">
          your command runs from within the workspace snapshot, which is a copy
          of your project. use relative paths for scripts, config files, and
          anything that&apos;s part of your project:
        </p>
        <CodeBlock>
          <code className="text-sm text-black whitespace-pre">{`# correct — relative paths resolve within the snapshot
rv run -t a100 -- torchrun --nproc_per_node=4 train.py
rv run python eval.py --config configs/eval.yaml
rv run python -m mypackage.train`}</code>
        </CodeBlock>
        <CodeBlock>
          <code className="text-sm text-black whitespace-pre">{`# WRONG — absolute paths bypass the workspace and may bypass the venv
rv run torchrun /scratch/user/sft/train_sft.py
rv run python /scratch/user/some_script.py`}</code>
        </CodeBlock>

        <p className="text-sm text-gray-600">
          why absolute script paths are dangerous:
        </p>
        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
          <li>
            the script may <code className="text-orange-accent">import</code>{" "}
            packages that only exist in the venv. if{" "}
            <code className="text-orange-accent">torchrun</code> or{" "}
            <code className="text-orange-accent">python</code> resolves to a
            system binary, those imports fail
          </li>
          <li>
            the script&apos;s working directory expectations break — relative
            paths inside the script won&apos;t find your config files
          </li>
          <li>
            rv&apos;s file sync and snapshot system is designed so your command
            runs from a complete copy of your project. using absolute paths to
            scripts elsewhere defeats this
          </li>
        </ul>

        <p className="text-sm text-gray-600">
          <strong className="text-black">
            absolute paths are fine for data
          </strong>{" "}
          — reading datasets, model weights, or other files on{" "}
          <code className="text-orange-accent">/scratch/</code> or{" "}
          <code className="text-orange-accent">/standard/</code> from within
          your script is expected:
        </p>
        <CodeBlock>
          <code className="text-sm text-black whitespace-pre">{`# this is fine — data paths can be absolute
model = AutoModel.from_pretrained("/scratch/user/.cache/huggingface/models/...")
dataset = load_dataset("json", data_files="/scratch/user/data/train.jsonl")`}</code>
        </CodeBlock>
      </section>

      {/* ── torchrun ───────────────────────────────────────────── */}
      <section
        id="torchrun"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">
          how torchrun works with rv
        </h3>
        <p className="text-sm text-gray-600">
          rv doesn&apos;t do anything magic with{" "}
          <code className="text-orange-accent">torchrun</code>. it just ensures
          the venv is activated before your command runs, which puts the
          venv&apos;s <code className="text-orange-accent">torchrun</code> on
          PATH.
        </p>
        <CodeBlock>
          <code className="text-sm text-black whitespace-pre">{`# what PATH looks like inside the job:
/scratch/{user}/.rv/envs/{project}/{branch}/bin   ← venv (torchrun, python, pip, etc.)
/apps/software/.../miniforge/24.11.3-py3.12/bin   ← module-loaded Python
/usr/bin                                           ← system (Python 3.6, DO NOT USE)`}</code>
        </CodeBlock>
        <p className="text-sm text-gray-600">
          since <code className="text-orange-accent">torch</code> is installed
          in the venv (from your{" "}
          <code className="text-orange-accent">requirements.txt</code> or{" "}
          <code className="text-orange-accent">pyproject.toml</code>),{" "}
          <code className="text-orange-accent">torchrun</code> is in the
          venv&apos;s <code className="text-orange-accent">bin/</code> directory
          and resolves first.
        </p>
        <p className="text-sm text-gray-600">
          rv also auto-injects{" "}
          <code className="text-orange-accent">--master-port=$MASTER_PORT</code>{" "}
          (a per-job unique port) to prevent collisions when multiple jobs land
          on the same node. for multi-node jobs, rv additionally sets{" "}
          <code className="text-orange-accent">--nnodes</code>,{" "}
          <code className="text-orange-accent">--node-rank</code>, and{" "}
          <code className="text-orange-accent">--master-addr</code>.
        </p>
        <CodeBlock>
          <code className="text-sm text-black whitespace-pre">{`# single-node multi-GPU
rv run -g 2 -t a6000 -- torchrun --nproc_per_node=2 train.py

# multi-node (rv handles srun + torchrun coordination)
rv run -g 8 -t a100 -- torchrun --nproc_per_node=4 train.py`}</code>
        </CodeBlock>
        <p className="text-sm text-gray-600">
          deepspeed configs can use relative paths since the cwd is the
          workspace snapshot:
        </p>
        <CodeBlock>
          <code className="text-sm text-black">
            rv run -g 4 -t a100 -- deepspeed --num_gpus=4 train.py --deepspeed
            ds_config.json
          </code>
        </CodeBlock>
      </section>

      {/* ── Two-phase install ──────────────────────────────────── */}
      <section
        id="two-phase-install"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">
          two-phase dependency install
        </h3>
        <p className="text-sm text-gray-600">
          rivanna&apos;s login node has no GPU and an older compiler toolchain.
          most Python packages install fine there, but some (flash-attn,
          auto-gptq, mamba-ssm, triton kernels) need CUDA or a modern GCC to
          compile. rv handles this with a two-phase strategy:
        </p>

        <div>
          <p className="text-sm font-medium text-black mb-1">
            phase 1 (login node, runs during{" "}
            <code className="text-orange-accent">rv run</code> before job
            submission)
          </p>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
            <li>
              creates the venv using{" "}
              <code className="text-orange-accent">uv venv</code> with
              module-loaded Python 3.12
            </li>
            <li>
              runs{" "}
              <code className="text-orange-accent">
                uv pip install -r requirements.txt
              </code>{" "}
              (or <code className="text-orange-accent">-e .</code> for
              pyproject.toml)
            </li>
            <li>
              if any package fails (typically CUDA-dependent ones), falls back
              to per-package install, skipping failures
            </li>
            <li>
              writes a <code className="text-orange-accent">.needs-phase2</code>{" "}
              marker if any packages were skipped
            </li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-1">
            phase 2 (compute node, runs at job start before your command)
          </p>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
            <li>
              only runs if{" "}
              <code className="text-orange-accent">.needs-phase2</code> exists
            </li>
            <li>
              loads <code className="text-orange-accent">gcc/11.4.0</code> for
              compilation
            </li>
            <li>
              retries the full install with{" "}
              <code className="text-orange-accent">--no-build-isolation</code>{" "}
              (so packages can find CUDA, torch, etc.)
            </li>
            <li>removes the marker on success</li>
          </ul>
        </div>

        <p className="text-sm text-gray-600">
          this means CUDA-dependent packages install the first time a job runs
          on a GPU node. the venv is persistent, so subsequent jobs skip this
          step (unless your deps file changes).
        </p>

        <div>
          <p className="text-sm font-medium text-black mb-1">
            what triggers a reinstall
          </p>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
            <li>
              rv hashes your deps file (SHA-256). if the hash changes, it
              reinstalls
            </li>
            <li>
              deleting the venv manually:{" "}
              <code className="text-orange-accent">
                rv exec &quot;rm -rf
                /scratch/$USER/.rv/envs/&#123;project&#125;/&#123;branch&#125;&quot;
              </code>
            </li>
            <li>first run on a new branch (each branch gets its own venv)</li>
          </ul>
        </div>
      </section>

      {/* ── Adding extra deps ──────────────────────────────────── */}
      <section
        id="extra-deps"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">
          adding extra dependencies
        </h3>
        <p className="text-sm text-gray-600">
          for packages beyond what&apos;s in your deps file:
        </p>
        <CodeBlock>
          <code className="text-sm text-black whitespace-pre">{`# option 1: add to your requirements.txt or pyproject.toml (recommended)
# rv reinstalls automatically when the file changes

# option 2: inline pip install in a wrapper script
rv run python -c "
import subprocess, sys
subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'sae-lens'])
from my_module import train
train()
"

# option 3: pip install in a shell-wrapped command
rv run "pip install sae-lens && python train.py"`}</code>
        </CodeBlock>
        <p className="text-xs text-gray-500">
          option 1 is strongly preferred because the packages persist across
          runs and are part of your git-tracked project.
        </p>
      </section>

      {/* ── Shell commands ─────────────────────────────────────── */}
      <section
        id="shell-commands"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">
          shell commands and dependency management
        </h3>
        <p className="text-sm text-gray-600 mb-3">
          rv only auto-manages dependencies when the command starts with{" "}
          <code className="text-orange-accent">python</code> or{" "}
          <code className="text-orange-accent">python3</code>. shell commands
          are treated as opaque:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-gray-200">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  command
                </th>
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  deps managed?
                </th>
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  venv active?
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  cmd: "rv run python train.py",
                  deps: "yes",
                  venv: "yes",
                },
                {
                  cmd: "rv run python -m torch.distributed.run train.py",
                  deps: "yes",
                  venv: "yes",
                },
                {
                  cmd: "rv run torchrun train.py",
                  deps: "yes",
                  venv: "yes",
                },
                {
                  cmd: 'rv run "bash train.sh"',
                  deps: "no",
                  venv: "yes",
                },
                {
                  cmd: 'rv run "make train"',
                  deps: "no",
                  venv: "yes",
                },
              ].map((r) => (
                <tr key={r.cmd} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-mono text-xs">{r.cmd}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {r.deps === "no" ? (
                      <strong className="text-black">{r.deps}</strong>
                    ) : (
                      r.deps
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.venv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">
          the venv is <strong>always activated</strong> regardless of command
          type. the difference is whether rv runs{" "}
          <code className="text-orange-accent">uv pip install</code> before
          submitting. if you use shell commands, your deps file is ignored but
          the venv&apos;s already-installed packages are still available.
        </p>
      </section>

      {/* ── System Python ──────────────────────────────────────── */}
      <section
        id="system-python"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">
          the system Python is ancient
        </h3>
        <p className="text-sm text-gray-600">
          rivanna&apos;s system Python is 3.6 (
          <code className="text-orange-accent">/usr/bin/python3</code>). it
          cannot run modern ML code. rv loads Python 3.12 via{" "}
          <code className="text-orange-accent">
            module load miniforge/24.11.3-py3.12
          </code>{" "}
          and creates the venv from that.
        </p>
        <p className="text-sm text-gray-600">if you see errors like:</p>
        <CodeBlock className="mb-2">
          <code className="text-sm text-black">
            SyntaxError: f-string expressions cannot include backslashes
          </code>
        </CodeBlock>
        <CodeBlock>
          <code className="text-sm text-black">
            ModuleNotFoundError: No module named &apos;dataclasses&apos;
          </code>
        </CodeBlock>
        <p className="text-sm text-gray-600">
          you&apos;re running on the system Python. this usually means the venv
          wasn&apos;t activated — see{" "}
          <a href="#troubleshooting" className="text-orange-accent underline">
            troubleshooting
          </a>{" "}
          below.
        </p>
      </section>

      {/* ── Verification ───────────────────────────────────────── */}
      <section
        id="verification"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">
          quick verification pattern
        </h3>
        <p className="text-sm text-gray-600">
          before burning a real GPU allocation, verify your environment on a
          free MIG slice:
        </p>
        <CodeBlock>
          <code className="text-sm text-black whitespace-pre">{`# test_env.py
import sys
print(f"Python: {sys.executable}")
print(f"Version: {sys.version}")

# verify key imports
import torch
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")

# add your project's critical imports
from transformers import AutoModel
print("All imports OK")`}</code>
        </CodeBlock>
        <CodeBlock>
          <code className="text-sm text-black whitespace-pre">{`rv run --mig --name test-deps python test_env.py
rv logs -f test-deps`}</code>
        </CodeBlock>
        <p className="text-sm text-gray-600">the output should show:</p>
        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
          <li>
            Python executable under{" "}
            <code className="text-orange-accent">
              /scratch/&#123;user&#125;/.rv/envs/...
            </code>{" "}
            (not <code className="text-orange-accent">/usr/bin/python3</code>)
          </li>
          <li>Python 3.12.x</li>
          <li>CUDA available: True</li>
        </ul>
      </section>

      {/* ── Troubleshooting ────────────────────────────────────── */}
      <section
        id="troubleshooting"
        className="border border-gray-200 p-4 sm:p-6 space-y-6"
      >
        <h3 className="text-lg font-semibold text-black">troubleshooting</h3>

        <div>
          <p className="text-sm font-medium text-black mb-1">
            ModuleNotFoundError
          </p>
          <p className="text-sm text-gray-600">
            check which Python is running by adding this to your script
            temporarily:
          </p>
          <CodeBlock>
            <code className="text-sm text-black whitespace-pre">{`import sys
print(f"executable: {sys.executable}", flush=True)
print(f"version: {sys.version}", flush=True)`}</code>
          </CodeBlock>

          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm border border-gray-200">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-3 py-2 border-b border-gray-200 font-medium">
                    sys.executable shows
                  </th>
                  <th className="px-3 py-2 border-b border-gray-200 font-medium">
                    cause
                  </th>
                  <th className="px-3 py-2 border-b border-gray-200 font-medium">
                    fix
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="px-3 py-2 font-mono text-xs">
                    /usr/bin/python3
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    system Python, venv not activated
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    use <code className="text-orange-accent">rv run</code>, not{" "}
                    <code className="text-orange-accent">rv exec</code>. use
                    relative paths
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="px-3 py-2 font-mono text-xs">
                    ~/.local/bin/python
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    user-installed Python
                  </td>
                  <td className="px-3 py-2 text-gray-600">same as above</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="px-3 py-2 font-mono text-xs">
                    /scratch/.../.rv/envs/.../bin/python
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    correct venv, package missing
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    add package to requirements.txt
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            the most common cause: using an absolute path to a script outside
            the workspace, or running directly on the cluster instead of through{" "}
            <code className="text-orange-accent">rv run</code>.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-1">
            GLIBCXX_3.4.29 not found
          </p>
          <p className="text-sm text-gray-600">
            the system&apos;s libstdc++ is too old for packages compiled against
            newer GCC. set{" "}
            <code className="text-orange-accent">LD_LIBRARY_PATH</code> to
            include a newer GCC&apos;s libraries:
          </p>
          <CodeBlock>
            <code className="text-sm text-black">
              rv env set LD_LIBRARY_PATH
              /apps/software/standard/core/gcc/14.2.0/lib64
            </code>
          </CodeBlock>
          <p className="text-xs text-gray-500 mt-1">
            this persists across all future jobs. verify the path exists first:{" "}
            <code className="text-orange-accent">
              rv exec &quot;ls
              /apps/software/standard/core/gcc/14.2.0/lib64/libstdc++.so*&quot;
            </code>
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-1">
            phase 2 install fails
          </p>
          <p className="text-sm text-gray-600">
            CUDA-dependent packages fail on the compute node. check stderr:
          </p>
          <CodeBlock>
            <code className="text-sm text-black">rv logs &lt;id&gt; --err</code>
          </CodeBlock>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1 mt-2">
            <li>
              pin a compatible version:{" "}
              <code className="text-orange-accent">flash-attn==2.5.8</code>{" "}
              instead of <code className="text-orange-accent">flash-attn</code>
            </li>
            <li>
              ensure torch is listed before CUDA-dependent packages in
              requirements.txt (phase 2 needs torch importable)
            </li>
            <li>
              try a pre-built wheel: add{" "}
              <code className="text-orange-accent">--find-links</code> to a pip
              install in your script
            </li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-1">stale venv</p>
          <p className="text-sm text-gray-600">
            if you&apos;ve made significant changes to deps and the venv seems
            broken:
          </p>
          <CodeBlock>
            <code className="text-sm text-black whitespace-pre">{`# delete the venv — next rv run recreates it
rv exec "rm -rf /scratch/$USER/.rv/envs/{project}/{branch}"

# check what exists
rv exec "ls /scratch/$USER/.rv/envs/"`}</code>
          </CodeBlock>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-1">
            don&apos;t manually pip install into the system Python
          </p>
          <CodeBlock>
            <code className="text-sm text-black whitespace-pre">{`# WRONG — installs into system Python 3.6, requires sudo, breaks things
rv exec "pip install torch"
rv exec "pip3 install transformers"
rv exec "/usr/bin/pip install ..."`}</code>
          </CodeBlock>
          <p className="text-sm text-gray-600 mt-2">
            <strong className="text-black">instead:</strong> add dependencies to
            your <code className="text-orange-accent">requirements.txt</code> or{" "}
            <code className="text-orange-accent">pyproject.toml</code> and let
            rv handle installation. if you need to install something
            interactively, get a shell on a compute node first:
          </p>
          <CodeBlock>
            <code className="text-sm text-black whitespace-pre">{`rv up --mig
# now you're in a shell with the venv activated
pip install some-package  # installs into rv's venv`}</code>
          </CodeBlock>
        </div>
      </section>
    </div>
  );
}
