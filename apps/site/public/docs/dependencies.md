# dependencies & environment

rv manages Python dependencies and virtual environments automatically. this page explains how it works end-to-end and how to avoid common pitfalls.

## how the venv works

when you run `rv run python train.py`, rv:

1. **syncs** your local project to the cluster via rsync (git-tracked files only)
2. **creates a persistent venv** at `/scratch/{user}/.rv/envs/{project}/{branch}/` if one doesn't exist
3. **installs dependencies** from `requirements.txt` or `pyproject.toml` using `uv pip install`
4. **creates an immutable snapshot** of your code (hardlink copy)
5. **generates a SLURM script** that activates the venv, `cd`s into the snapshot, and runs your command

the generated job script looks roughly like this:

```bash
#!/bin/bash
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
# ...

# cd into the snapshot
cd /scratch/{user}/rv-workspaces/{project}/{branch}/snapshots/{jobName}-{timestamp}/

# run your command
python train.py
```

the key insight: **your command runs inside an activated venv from within the workspace snapshot.** this means:

- `python` resolves to the venv's Python 3.12 (not the system's Python 3.6)
- `torchrun`, `accelerate`, `deepspeed`, and other entry points installed by your dependencies are on PATH
- `pip` and `uv` target the venv
- relative paths (`train.py`, `configs/base.yaml`) resolve against the snapshot directory, which contains your synced project files

## use relative paths for scripts

**this is the most common mistake agents and users make.**

your command runs from within the workspace snapshot, which is a copy of your project. use relative paths for scripts, config files, and anything that's part of your project:

```bash
# correct - relative paths resolve within the snapshot
rv run -t a100 -- torchrun --nproc_per_node=4 train.py
rv run python eval.py --config configs/eval.yaml
rv run python -m mypackage.train

# WRONG - absolute paths bypass the workspace and may bypass the venv
rv run torchrun /scratch/user/sft/train_sft.py
rv run python /scratch/user/some_script.py
```

why absolute script paths are dangerous:

- the script may `import` packages that only exist in the venv. if `torchrun` or `python` resolves to a system binary (because of PATH ordering or a misconfiguration), those imports fail
- the script's working directory expectations break — relative paths inside the script won't find your config files, data paths, etc.
- rv's file sync and snapshot system is designed so your command runs from a complete copy of your project. using absolute paths to scripts elsewhere defeats this

**absolute paths are fine for data** — reading datasets, model weights, or other files on `/scratch/` or `/standard/` from within your script is expected:

```python
# this is fine - data paths can be absolute
model = AutoModel.from_pretrained("/scratch/user/.cache/huggingface/models/...")
dataset = load_dataset("json", data_files="/scratch/user/data/train.jsonl")
```

## how torchrun works with rv

rv doesn't do anything magic with `torchrun`. it just ensures the venv is activated before your command runs, which puts the venv's `torchrun` on PATH.

```
# what PATH looks like inside the job:
/scratch/{user}/.rv/envs/{project}/{branch}/bin   <-- venv (torchrun, python, pip, etc.)
/apps/software/.../miniforge/24.11.3-py3.12/bin   <-- module-loaded Python
/usr/bin                                           <-- system (Python 3.6, DO NOT USE)
```

since `torch` is installed in the venv (from your `requirements.txt` or `pyproject.toml`), `torchrun` is in the venv's `bin/` directory and resolves first.

rv also auto-injects `--master-port=$MASTER_PORT` (a per-job unique port) to prevent collisions when multiple jobs land on the same node. for multi-node jobs, rv additionally sets `--nnodes`, `--node-rank`, and `--master-addr`.

```bash
# single-node multi-GPU
rv run -g 2 -t a6000 -- torchrun --nproc_per_node=2 train.py

# multi-node (rv handles srun + torchrun coordination)
rv run -g 8 -t a100 -- torchrun --nproc_per_node=4 train.py
```

deepspeed configs can use relative paths since the cwd is the workspace snapshot:

```bash
rv run -g 4 -t a100 -- deepspeed --num_gpus=4 train.py --deepspeed ds_config.json
```

## two-phase dependency install

rivanna's login node has no GPU and an older compiler toolchain. most Python packages install fine there, but some (flash-attn, auto-gptq, mamba-ssm, triton kernels) need CUDA or a modern GCC to compile. rv handles this with a two-phase strategy:

**phase 1 (login node, runs during `rv run` before job submission):**

- creates the venv using `uv venv` with module-loaded Python 3.12
- runs `uv pip install -r requirements.txt` (or `-e .` for pyproject.toml)
- if any package fails (typically CUDA-dependent ones), falls back to per-package install, skipping failures
- writes a `.needs-phase2` marker if any packages were skipped

**phase 2 (compute node, runs at job start before your command):**

- only runs if `.needs-phase2` exists
- loads `gcc/11.4.0` for compilation
- retries the full install with `--no-build-isolation` (so packages can find CUDA, torch, etc.)
- removes the marker on success

this means CUDA-dependent packages install the first time a job runs on a GPU node. the venv is persistent, so subsequent jobs skip this step (unless your deps file changes).

**what triggers a reinstall:**

- rv hashes your deps file (SHA-256). if the hash changes, it reinstalls
- deleting the venv manually: `rv exec "rm -rf /scratch/$USER/.rv/envs/{project}/{branch}"`
- first run on a new branch (each branch gets its own venv)

## adding extra dependencies

for packages beyond what's in your deps file:

```bash
# option 1: add to your requirements.txt or pyproject.toml (recommended)
# rv reinstalls automatically when the file changes

# option 2: inline pip install in a wrapper script
rv run python -c "
import subprocess, sys
subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'sae-lens'])
from my_module import train
train()
"

# option 3: pip install in a shell-wrapped command
rv run "pip install sae-lens && python train.py"
```

option 1 is strongly preferred because the packages persist across runs and are part of your git-tracked project.

## shell commands and dependency management

rv only auto-manages dependencies when the command starts with `python` or `python3`. shell commands are treated as opaque:

| command                                           | deps managed? | venv active? |
| ------------------------------------------------- | ------------- | ------------ |
| `rv run python train.py`                          | yes           | yes          |
| `rv run python -m torch.distributed.run train.py` | yes           | yes          |
| `rv run torchrun train.py`                        | yes           | yes          |
| `rv run "bash train.sh"`                          | **no**        | yes          |
| `rv run "make train"`                             | **no**        | yes          |

note: the venv is **always activated** regardless of command type. the difference is whether rv runs `uv pip install` before submitting. if you use shell commands, your deps file is ignored but the venv's already-installed packages are still available.

## the system Python is ancient

rivanna's system Python is 3.6 (`/usr/bin/python3`). it cannot run modern ML code. rv loads Python 3.12 via `module load miniforge/24.11.3-py3.12` and creates the venv from that.

if you see errors like:

```
SyntaxError: f-string expressions cannot include backslashes
```

or:

```
ModuleNotFoundError: No module named 'dataclasses'
```

you're running on the system Python. this usually means the venv wasn't activated — see [troubleshooting](#troubleshooting) below.

## quick verification pattern

before burning a real GPU allocation, verify your environment on a free MIG slice:

```python
# test_env.py
import sys
print(f"Python: {sys.executable}")
print(f"Version: {sys.version}")

# verify key imports
import torch
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")

# add your project's critical imports
from transformers import AutoModel
print("All imports OK")
```

```bash
rv run --mig --name test-deps python test_env.py
rv logs -f test-deps
```

the output should show:

- Python executable under `/scratch/{user}/.rv/envs/...` (not `/usr/bin/python3`)
- Python 3.12.x
- CUDA available: True

## troubleshooting

### ModuleNotFoundError

**symptom:** `ModuleNotFoundError: No module named 'torch'` (or any package you expect to be installed)

**diagnosis:** check which Python is running:

```python
# add this to the top of your script temporarily
import sys
print(f"executable: {sys.executable}", flush=True)
print(f"version: {sys.version}", flush=True)
```

**likely causes:**

| `sys.executable` shows                 | cause                             | fix                                                         |
| -------------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| `/usr/bin/python3`                     | system Python, venv not activated | use `rv run`, not `rv exec`. use relative paths for scripts |
| `~/.local/bin/python`                  | user-installed Python             | same as above                                               |
| `/scratch/.../.rv/envs/.../bin/python` | correct venv, but package missing | add package to requirements.txt                             |

**the most common cause:** using an absolute path to a script outside the workspace, or running directly on the cluster instead of through `rv run`.

### GLIBCXX_3.4.29 not found

**symptom:**

```
ImportError: /lib64/libstdc++.so.6: version `GLIBCXX_3.4.29' not found
```

**cause:** the system's libstdc++ is too old for packages compiled against newer GCC.

**fix:** set `LD_LIBRARY_PATH` to include a newer GCC's libraries:

```bash
rv env set LD_LIBRARY_PATH /apps/software/standard/core/gcc/14.2.0/lib64
```

this persists across all future jobs. verify the path exists first:

```bash
rv exec "ls /apps/software/standard/core/gcc/14.2.0/lib64/libstdc++.so*"
```

### phase 2 install fails

**symptom:** CUDA-dependent packages (flash-attn, auto-gptq) fail to install on the compute node.

**diagnosis:** check job stderr:

```bash
rv logs <id> --err
```

**common fixes:**

- pin a compatible version: `flash-attn==2.5.8` instead of `flash-attn`
- ensure torch is listed before cuda-dependent packages in requirements.txt (phase 2 needs torch importable)
- try a pre-built wheel: add `--find-links https://...` to a pip install in your script

### stale venv

if you've made significant changes to deps and the venv seems broken:

```bash
# delete the venv — next rv run recreates it
rv exec "rm -rf /scratch/$USER/.rv/envs/{project}/{branch}"
```

replace `{project}` and `{branch}` with your actual project name and branch. check what exists:

```bash
rv exec "ls /scratch/$USER/.rv/envs/"
```

### don't manually pip install into the system Python

**never do this:**

```bash
# WRONG - installs into system Python 3.6, requires sudo, breaks things
rv exec "pip install torch"
rv exec "pip3 install transformers"
rv exec "/usr/bin/pip install ..."
```

**instead:** add dependencies to your `requirements.txt` or `pyproject.toml` and let rv handle installation through its venv. if you need to install something interactively, get a shell on a compute node first:

```bash
rv up --mig
# now you're in a shell with the venv activated
pip install some-package  # installs into rv's venv
```
