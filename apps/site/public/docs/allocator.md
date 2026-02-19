# smart allocator

rv doesn't just submit to one partition and wait. it probes the cluster, generates every compatible strategy, and submits them all in parallel. the first one to start running wins — the rest get cancelled.

## how it works

1. **probe cluster** — rv queries Slurm for current GPU availability, queue depth, and backfill windows across all partitions
2. **generate strategies** — for your requested GPU count, rv generates all compatible combinations: GPU type, partition, single-node vs multi-node topology, direct vs backfill vs checkpoint-restart
3. **rank and prune** — strategies are ranked by estimated wait time and SU cost. dominated strategies (same GPU type and topology but worse on all metrics) are pruned
4. **fan-out submit** — all surviving strategies are submitted to Slurm simultaneously
5. **first wins** — rv monitors all submissions. the first job to reach RUNNING state wins; all other pending jobs are cancelled

```bash
rv up --dry-run    # see all strategies without submitting
```

## fan-out strategy

when you request GPUs without specifying a type, rv submits to every compatible partition at once. for example, requesting 4 GPUs might generate strategies for A6000, A40, A100 (40GB), A100 (80GB), V100, and multi-node variants (2x2) for each.

this works because Slurm allows multiple pending jobs. whichever partition has resources first wins. rv cancels the losers automatically — you're never charged for jobs that don't run.

if you specify a GPU type with `--type`, rv only generates strategies for that type (but still explores single-node, multi-node, direct, and backfill variants).

## backfill detection

Slurm's backfill scheduler can start smaller/shorter jobs ahead of the queue if they fit in the gaps. rv detects these windows using `sbatch --test-only` and generates backfill strategies with `--time-min` set to the detected window.

this is why the default walltime of `2:59:00` is recommended — jobs under 3 hours are most likely to find backfill opportunities.

## checkpoint-restart

for long-running jobs (e.g. 24h training), rv can break the work into segments that fit within backfill windows. each segment:

1. runs your command with a `timeout` set to the walltime minus a 10-minute buffer
2. sends `SIGUSR1` to your process before time expires (your code should save a checkpoint)
3. auto-resubmits the same script with `RV_TOTAL_ELAPSED` tracking cumulative time
4. stops resubmitting once the total requested time has been reached

checkpoint strategies only appear when backfill windows are available but shorter than your total requested time. your training code needs to handle SIGUSR1 by saving state and resuming from the latest checkpoint on restart.

## gpu types

available GPU types on Rivanna. MIG slices are free and don't consume SUs.

| type    | VRAM   | SU/GPU-hr | max/user | max/job | per node |
| ------- | ------ | --------- | -------- | ------- | -------- |
| mig     | 10 GB  | **free**  | 28       | 1       | 56       |
| v100    | 32 GB  | 20.96     | 32       | 4       | 4        |
| rtx3090 | 24 GB  | 113.23    | 2        | 2       | 4        |
| a6000   | 48 GB  | 142.73    | 32       | 8       | 8        |
| a40     | 48 GB  | 186.69    | 32       | 8       | 8        |
| a100_40 | 40 GB  | 463.81    | 32       | 8       | 8        |
| a100_80 | 80 GB  | 508.89    | 32       | 8       | 8        |
| h200    | 141 GB | 816.67    | 4        | 4       | 8        |

A100 (80GB) nodes have InfiniBand and NVLink interconnects. use `rv cost` to estimate SU costs for your job configuration.
