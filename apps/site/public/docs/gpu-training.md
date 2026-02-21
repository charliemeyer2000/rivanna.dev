# guides

tips, GPU training best practices, and troubleshooting — all verified on Rivanna.

## tips & gotchas

**argument ordering.** rv options must come **before** the command. anything after is passed through. rv warns if it detects misplaced flags.

```bash
# correct
rv run -g 4 -t a100 python train.py

# wrong — -g 4 becomes a python argument
rv run python train.py -g 4 -t a100
```

**file sync.** `rv run` uploads your current directory. only git-tracked files sync. each job gets an immutable snapshot. use `.rvignore` to exclude extra files.

**output buffering.** rv auto-sets `PYTHONUNBUFFERED=1`. if you still see no output, check `rv logs --err` — the job may have crashed.

**rv exec is login-node only.** no GPU access. use for file checks and queries. for GPU utilization, use `rv gpu`.

**backfill scheduling.** jobs under 3 hours qualify for backfill — often near-instant allocation. the default walltime (2:59:00) is set just below this threshold.

## queue times

| GPU type | typical wait | SU/GPU-hr | VRAM   |
| -------- | ------------ | --------- | ------ |
| `mig`    | instant      | FREE      | 10 GB  |
| `v100`   | ~3 days      | 21        | 32 GB  |
| `a6000`  | ~18 hours    | 143       | 48 GB  |
| `a100`   | ~10 hours    | 509       | 80 GB  |
| `h200`   | varies       | 817       | 141 GB |

check real-time availability with `rv status`.

## training overview

**single GPU:**

```bash
rv run --mig python train.py              # free MIG slice
rv run -g 1 -t a6000 python train.py      # dedicated GPU
```

**multi-GPU (DDP/FSDP):**

```bash
rv run -g 2 -t a6000 -- torchrun --nproc_per_node=2 train.py
```

**multi-node:**

```bash
rv run -g 4 -t a100 -- torchrun --nproc_per_node=2 train.py
```

rv handles srun + torchrun coordination automatically. BF16 on A100/H200 (compute capability >= 8). FP16 + GradScaler on older GPUs.

## process groups

NCCL for GPU tensors, Gloo for CPU tensors. wrong backend = silent hang.

```python
dist.init_process_group("nccl")  # GPU default

# CPU collectives (strings, dicts, metadata):
cpu_group = dist.new_group(backend="gloo")
dist.all_gather_object(output_list, my_dict, group=cpu_group)
```

## ddp

```python
model = DDP(model, device_ids=[local_rank])
```

- never call `model.module.forward()` directly — bypasses gradient sync
- `find_unused_parameters=True` for conditional/multi-head models
- save with `model.module.state_dict()` (unwrap DDP)
- `sampler.set_epoch(epoch)` in every epoch for correct shuffling

## fsdp

| strategy      | what's sharded             | memory               | speed   |
| ------------- | -------------------------- | -------------------- | ------- |
| FULL_SHARD    | params + grads + optimizer | lowest (63% savings) | slowest |
| SHARD_GRAD_OP | grads + optimizer          | medium               | medium  |
| NO_SHARD      | nothing (same as DDP)      | highest              | fastest |

```python
# NEVER use always_wrap_policy
auto_wrap_policy = functools.partial(size_based_auto_wrap_policy, min_num_params=1_000_000)
model = FSDP(model, auto_wrap_policy=auto_wrap_policy, ...)
```

CPU offload saves ~29% GPU memory but is 26x slower. last resort only.

## mixed precision

```python
# BF16 (A100/H200) — no GradScaler needed
with torch.amp.autocast("cuda", dtype=torch.bfloat16):
    loss = loss_fn(model(input), target)
loss.backward()
optimizer.step()

# FP16 (older GPUs) — needs GradScaler
scaler = torch.amp.GradScaler("cuda")
with torch.amp.autocast("cuda", dtype=torch.float16):
    loss = loss_fn(model(input), target)
scaler.scale(loss).backward()
scaler.step(optimizer)
scaler.update()
```

## checkpointing

```python
# save (rank 0 only)
checkpoint = {
    'model': model.module.state_dict(),
    'optimizer': optimizer.state_dict(),
    'epoch': epoch,
    'rng_cpu': torch.random.get_rng_state(),
    'rng_cuda': torch.cuda.get_rng_state(device),
}
if rank == 0: torch.save(checkpoint, path)
dist.barrier()

# load — MUST use map_location='cpu' and weights_only=False
ckpt = torch.load(path, map_location='cpu', weights_only=False)
```

- `weights_only=True` fails on optimizer/RNG states
- `map_location='cuda:0'` breaks RNG restore
- always save `model.module.state_dict()` (unwrapped)
- skipping optimizer state means Adam forgets momentum after resume

## rlhf & grpo

```python
# GRPO: generate G completions, normalize rewards within group
advantages = (rewards - rewards.mean()) / (rewards.std() + 1e-8)
loss = -(log_probs * advantages).mean() + kl_coef * kl
```

- reference model must be frozen: `ref_model.eval()`
- multi-GPU: sync rewards and advantages across ranks
- OpenRLHF needs Gloo for CPU reward aggregation
- memory: 4x model size minimum (actor + critic + reward + ref)

## debugging

**hangs:** mismatched collectives across ranks, missing `dist.barrier()`, NCCL timeout (increase with `NCCL_TIMEOUT=1800`), data loader length mismatch.

**OOM:** gradient accumulation, mixed precision, activation checkpointing, FSDP FULL_SHARD (63% savings).

## troubleshooting

**job stuck in PENDING:** check `rv status`, try a different GPU type, use `--mig` for instant free allocation, reduce `--time` below 3h for backfill.

**no output files:** check `rv logs --err` for errors. write to `/scratch/` not `/tmp/` (node-local). the job CWD is the snapshot, not your live code.

**can't find results:**

```bash
rv exec "ls /scratch/USER/.rv/logs/"       # log files
rv exec "ls /scratch/USER/rv-workspaces/"  # synced code
rv sync pull /remote/path ./local/         # download
```
