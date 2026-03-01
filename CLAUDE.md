# rv CLI — Claude Code Agent Guide

`rv` is a CLI for GPU computing on UVA's Rivanna HPC cluster. It wraps SLURM, handles file syncing, and manages jobs. This doc covers everything an agent needs to use it effectively.

Full docs: `apps/site/public/docs/` (commands.md, configuration.md, allocator.md, gpu-training.md, getting-started.md, tips.md)

## Quick Reference

```bash
# Submit a batch job (returns immediately)
rv run -t a100 --time 3h --name "my-job" python train.py

# Submit and wait for output
rv run -t a100 --time 3h --name "my-job" -f python train.py

# Auto-copy outputs from snapshot to persistent storage after job
rv run --output ./artifacts ./results python train.py

# Force single-node for inference (no multi-node strategies)
rv run -g 4 -t a100 --single-node python generate.py

# Check job status (also: rv ls)
rv ps

# View logs (auto-follows running jobs)
rv logs <jobId>

# Cancel a job by ID or name (also: rv cancel)
rv stop <jobId>
rv stop <jobName>

# Run a quick command on login node (no GPU)
rv exec "ls /scratch/abs6bd/"

# Check GPU utilization of a running job
rv gpu <jobId>

# Import env vars from .env file (bulk)
rv env import .env

# Set environment variable for all future jobs
rv env set KEY VALUE

# Pull results from remote
rv sync pull /scratch/abs6bd/results ./local_results/
```

## GPU Types (choose with `-t`)

| Type    | VRAM   | SU/GPU-hr | Best For                    |
| ------- | ------ | --------- | --------------------------- |
| `mig`   | 10 GB  | FREE      | Quick tests, CPU-only work  |
| `a6000` | 48 GB  | 143       | 7B inference, LoRA training |
| `a100`  | 80 GB  | 509       | 7B-13B full FT, multi-GPU   |
| `h200`  | 141 GB | 817       | Large models, fastest       |
| `v100`  | 32 GB  | 21        | Cheap, older                |

`-t a100` maps to A100-80GB by default.

## Critical Gotchas (from real usage)

### 1. `rv stop` and `rv cancel` are the same command

Both work — `rv cancel` is an alias for `rv stop`. Accepts job IDs or job names, and is strategy-group-aware:

```bash
rv stop <jobId>      # cancels job + prompts to cancel sibling strategies
rv stop <jobName>    # cancels all strategies for that job name
rv cancel <jobId>    # also works (alias)
rv stop --all        # cancels everything
```

**Do not use `scancel` directly.** `rv stop` is aware of fan-out strategy groups and will cancel siblings together. Using `scancel` on one strategy can leave orphans or lose queue position.

### 2. `rv ps` time format

Times display as `MM:SS` for short durations, `H:MM:SS` for longer ones, and `D-HH:MM:SS` for multi-day jobs. **Do not misread `1:29` as 1 hour 29 minutes — it's 1 minute 29 seconds.** Check the number of colons:

- `1:29` = 1 min 29 sec
- `1:01:29` = 1 hr 1 min 29 sec
- `1-01:29:00` = 1 day 1 hr 29 min

### 3. Python stdout buffering (auto-handled)

rv automatically sets `PYTHONUNBUFFERED=1` in every job, so Python output appears in real time. If you still see no output, the script may be writing to a file or using internal buffering. You can also force it manually with `python -u train.py`.

### 4. Job logs location

Logs are stored at `/scratch/<user>/.rv/logs/<jobName>-<jobId>.out` (and `.err`). You can view them with:

```bash
rv logs <jobId>          # stdout
rv logs <jobId> --err    # stderr
rv logs <jobId> --pull   # download locally
```

### 5. Checking GPU utilization of running jobs

Use `rv gpu` to check GPU utilization of a running job:

```bash
rv gpu              # most recent running job
rv gpu <jobId>      # specific job
```

### 6. `rv exec` runs on the login node

`rv exec` does NOT run on GPU nodes. It runs on the login node (no GPU, shared, limited resources). Use it for file checks, `sacct` queries, etc. — not for GPU work.

### 7. File sync is git-aware

`rv run python script.py` automatically syncs your local project to Rivanna before running. It:

- Only syncs git-tracked files (respects `.gitignore`)
- Creates an immutable snapshot so subsequent syncs don't corrupt running jobs
- Organizes by `{project}/{branch}/` on the remote

You can also create a `.rvignore` file (same syntax as `.gitignore`) to exclude additional files.

### 8. Write outputs and checkpoints to persistent storage

Jobs run inside an ephemeral snapshot directory. Files written to relative paths land in the snapshot and are pruned after 7 days. Use one of these approaches:

**Option A: Use `RV_OUTPUT_DIR` (recommended for results).** Set automatically in every job (per-job-ID), persists across snapshot pruning:

```python
import os
output_dir = os.environ.get("RV_OUTPUT_DIR", "./results")
os.makedirs(output_dir, exist_ok=True)
torch.save(model.state_dict(), f"{output_dir}/model.pt")
```

**Option B: Use `RV_CHECKPOINT_DIR` (recommended for checkpoints).** Set automatically, keyed by job **name** (not ID) so jobs with the same `--name` share checkpoints and can resume across runs:

```python
import os
ckpt_dir = os.environ.get("RV_CHECKPOINT_DIR", "./checkpoints")
os.makedirs(ckpt_dir, exist_ok=True)
torch.save(checkpoint, f"{ckpt_dir}/latest.pt")
```

**Option C: Use `--output` flag.** Copies specified paths from the snapshot to persistent storage after the job completes — no script changes needed:

```bash
rv run -t a100 --output ./artifacts ./results python train.py
```

**Option D: Write to `/scratch/` directly:**

```python
import os
SCRATCH = os.environ.get("SCRATCH", "/scratch/abs6bd")
output_dir = f"{SCRATCH}/my-results"
os.makedirs(output_dir, exist_ok=True)
```

Output dir location: `/scratch/<user>/.rv/outputs/<jobName>-<jobId>/`. Checkpoint dir location: `/scratch/<user>/.rv/checkpoints/<jobName>/`. Pull locally with `rv sync pull <path> ./local/`.

### 9. Environment variables are global, not per-project

`rv env` stores variables that are injected into ALL future jobs across all projects and branches. Use them for credentials and identity — not experiment config:

```bash
rv env import .env                   # bulk-import from local .env file
rv env set HF_TOKEN hf_abc123...     # or set individually
rv env set OPENAI_API_KEY sk-...     # for eval judges
```

View with `rv env list`. Remove with `rv env rm KEY`.

For experiment-specific configuration (hyperparams, model paths, etc.), use config files (Hydra, argparse, YAML) — they're git-tracked and per-branch by design.

### 10. Default walltime is 2:59:00 (just under 3h)

This is intentional — jobs under 3 hours qualify for backfill scheduling, which often means near-instant allocation. For longer jobs, specify `--time`:

```bash
rv run --time 10h -t a100 python train.py
```

### 11. grep on Rivanna doesn't support `-P` (Perl regex)

The `grep` on Rivanna compute nodes doesn't have Perl regex support. Use basic or extended regex, or tools like `awk`/`sed` instead.

## Common Patterns for Agents

### Dependency management

rv auto-detects `requirements.txt` or `pyproject.toml` and installs deps into a persistent per-branch venv using `uv pip install`. The venv is auto-activated — use bare `python` in scripts, not `uv run` or `uv sync`. For additional packages beyond your deps file, add `pip install foo` to your script — it installs into rv's active venv and persists.

### Use MIG as a pre-flight check

Before submitting to expensive GPUs, validate on a free MIG slice:

```bash
rv run --mig python train.py              # free, instant
rv run -t a100 --time 6h python train.py  # real run after validation
```

### Submit a job and poll for completion

```bash
# Submit and follow (recommended — prints snapshot path + sync commands on completion)
rv run -t a100 --time 6h --name "training-run" -f python train.py

# Or submit without following and poll manually
rv run -t a100 --time 6h --name "training-run" python train.py

# Check status periodically
rv ps --json  # machine-readable output

# A job is done when rv ps no longer shows it (or shows COMPLETED with -a)
rv ps -a  # show completed jobs from last 7 days
```

### Run multiple independent jobs in parallel

```bash
rv run -t a100 --time 3h --name "eval-condition-1" python eval.py --condition fv_shaped
rv run -t a100 --time 3h --name "eval-condition-2" python eval.py --condition random_reward
rv run -t a100 --time 3h --name "eval-condition-3" python eval.py --condition zero_reward
# All submitted in parallel, rv handles allocation independently
```

### Monitor a batch of jobs

```bash
# List all active jobs
rv ps

# Check if specific job is still running
rv ps --json | grep "training-run"

# Follow logs of a specific job
rv logs <jobId> -f
```

### Pull results after completion

```bash
rv sync pull /scratch/abs6bd/my-results/ ./local-results/
```

### Check cluster availability before submitting

```bash
rv status  # shows GPU availability, queue depth, storage
```

### Estimate cost before submitting

```bash
rv cost -g 1 -t a100 --time 6h   # single GPU, 6 hours
rv cost -g 4 -t a6000 --time 3h  # 4 GPUs, 3 hours
```

## Multi-Node Jobs

For jobs needing >8 GPUs or multiple nodes:

```bash
rv run -g 8 -t a100 --time 12h -- torchrun --nproc_per_node=4 train.py
```

- `rv` handles srun + torchrun coordination
- Logs are per-node: `rv logs <jobId> --node 0`, `rv logs <jobId> --node 1`

## What rv Does Automatically

- **File sync**: Detects local files in your command, rsyncs project to Rivanna
- **Snapshot isolation**: Creates immutable copy so running jobs aren't affected by later syncs
- **Dependency install**: Detects `requirements.txt` / `pyproject.toml`, auto-installs via `uv pip install`
- **Fan-out allocation**: Submits to multiple GPU types simultaneously, cancels losers when first job starts
- **Environment injection**: Loads all `rv env` variables + sane defaults (OMP_NUM_THREADS, HF_HOME, etc.)
- **Scratch keepalive**: Prevents 90-day purge of `/scratch/` files

## Troubleshooting

**Job stuck in PENDING for a long time?**

- Check `rv status` for GPU availability
- Try a different GPU type: `-t a6000` (104 available) vs `-t a100` (32 max)
- Use `--mig` for instant free allocation (10GB VRAM, good for testing)
- Reduce `--time` below 3h for backfill eligibility

**Job completed but no output files?**

- Check `rv logs <jobId>` and `rv logs <jobId> --err` for errors
- Most likely cause: script wrote to a relative path, so outputs are in the snapshot (see gotcha #8)
- Verify your script writes to an absolute `/scratch/` path (not relative paths, and not `/tmp/` which is node-local)
- The job CWD is a snapshot, not your live code — relative writes go there

**Can't find results?**

- `rv exec "ls /scratch/abs6bd/.rv/logs/"` — check log files
- `rv exec "ls /scratch/abs6bd/rv-workspaces/"` — check synced code and snapshots
- If outputs are in a snapshot: `rv sync pull /scratch/abs6bd/rv-workspaces/<project>/<branch>/snapshots/<jobName>-<timestamp>/ ./local/`
- `rv sync pull /remote/path ./local/` — download any remote path

**OOM (out of memory)?**

- Reduce batch size or use gradient checkpointing
- Use a bigger GPU: `-t a100` (80GB) or `-t h200` (141GB)
- For training: use QLoRA/LoRA to reduce memory
- Request more CPU memory: `--mem 200G`
