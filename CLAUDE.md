# rv CLI — Claude Code Agent Guide

`rv` is a CLI for GPU computing on UVA's Rivanna HPC cluster. It wraps SLURM, handles file syncing, and manages jobs. This doc covers everything an agent needs to use it effectively.

Full docs: `apps/site/public/docs/` (commands.md, configuration.md, allocator.md, gpu-training.md, getting-started.md)

## Quick Reference

```bash
# Submit a batch job (returns immediately)
rv run -t a100 --time 3h --name "my-job" python train.py

# Submit and wait for output
rv run -t a100 --time 3h --name "my-job" -f python train.py

# Check job status
rv ps

# View logs (auto-follows running jobs)
rv logs <jobId>

# Cancel a job
rv stop <jobId>

# Run a quick command on login node (no GPU)
rv exec "ls /scratch/abs6bd/"

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

### 1. The command to cancel is `rv stop`, NOT `rv cancel`

```bash
rv stop <jobId>      # correct
rv cancel <jobId>    # WRONG — this command doesn't exist
```

### 2. `rv ps` time format

Times display as `MM:SS` for short durations, `H:MM:SS` for longer ones, and `D-HH:MM:SS` for multi-day jobs. **Do not misread `1:29` as 1 hour 29 minutes — it's 1 minute 29 seconds.** Check the number of colons:

- `1:29` = 1 min 29 sec
- `1:01:29` = 1 hr 1 min 29 sec
- `1-01:29:00` = 1 day 1 hr 29 min

### 3. Python stdout buffering

When Python writes to files (not a TTY), stdout is fully buffered. Jobs will appear to produce no output for minutes/hours. **Always set this:**

```bash
rv env set PYTHONUNBUFFERED 1
```

This affects all future jobs. Alternatively, run Python with `-u`: `python -u train.py`

### 4. Job logs location

Logs are stored at `/scratch/<user>/.rv/logs/<jobName>-<jobId>.out` (and `.err`). You can view them with:

```bash
rv logs <jobId>          # stdout
rv logs <jobId> --err    # stderr
rv logs <jobId> --pull   # download locally
```

### 5. Checking GPU utilization of running jobs

`rv` doesn't have a built-in GPU utilization command. Use SLURM directly:

```bash
rv exec "srun --jobid=<jobId> --overlap nvidia-smi"
```

### 6. `rv exec` runs on the login node

`rv exec` does NOT run on GPU nodes. It runs on the login node (no GPU, shared, limited resources). Use it for file checks, `sacct` queries, etc. — not for GPU work.

### 7. File sync is git-aware

`rv run python script.py` automatically syncs your local project to Rivanna before running. It:

- Only syncs git-tracked files (respects `.gitignore`)
- Creates an immutable snapshot so subsequent syncs don't corrupt running jobs
- Organizes by `{project}/{branch}/` on the remote

You can also create a `.rvignore` file (same syntax as `.gitignore`) to exclude additional files.

### 8. Environment variables persist across jobs

`rv env set` stores variables that are injected into ALL future jobs. Useful for:

```bash
rv env set HF_TOKEN hf_abc123...
rv env set PYTHONUNBUFFERED 1
rv env set HF_ALLOW_CODE_EVAL 1
rv env set OPENAI_API_KEY sk-...    # for eval judges
```

View with `rv env list`. Remove with `rv env rm KEY`.

### 9. Default walltime is 2:59:00 (just under 3h)

This is intentional — jobs under 3 hours qualify for backfill scheduling, which often means near-instant allocation. For longer jobs, specify `--time`:

```bash
rv run --time 10h -t a100 python train.py
```

### 10. grep on Rivanna doesn't support `-P` (Perl regex)

The `grep` on Rivanna compute nodes doesn't have Perl regex support. Use basic or extended regex, or tools like `awk`/`sed` instead.

## Common Patterns for Agents

### Submit a job and poll for completion

```bash
# Submit
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
- Verify your script writes to `/scratch/` (not `/tmp/` which is node-local)
- Remember: the working directory inside the job is the snapshot, not your live code

**Can't find results?**

- `rv exec "ls /scratch/abs6bd/.rv/logs/"` — check log files
- `rv exec "ls /scratch/abs6bd/rv-workspaces/"` — check synced code
- `rv sync pull /remote/path ./local/` — download results

**OOM (out of memory)?**

- Reduce batch size or use gradient checkpointing
- Use a bigger GPU: `-t a100` (80GB) or `-t h200` (141GB)
- For training: use QLoRA/LoRA to reduce memory
- Request more CPU memory: `--mem 200G`
