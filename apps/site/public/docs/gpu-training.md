# gpu training

best practices for distributed training on Rivanna. covers DDP, FSDP, mixed precision, checkpointing, RLHF, and common debugging patterns. verified across 10 test suites (52/53 passed) using A6000, A100, and MIG GPUs.

## overview

pick the right setup for your workload:

**single GPU** (MIG or dedicated):

```bash
rv run --mig --time 10m -- python train.py            # free MIG slice
rv run --gpu 1 --type a6000 --time 1h -- python train.py   # dedicated GPU
```

no torchrun, no init_process_group. use `torch.amp.autocast` for mixed precision. BF16 on A100/H100 (compute capability >= 8), FP16 on older GPUs.

**multi-GPU, single node** (DDP/FSDP):

```bash
rv run --gpu 2 --type a6000 --time 1h -- torchrun --nproc_per_node=2 train.py
```

torchrun sets RANK, LOCAL_RANK, WORLD_SIZE, MASTER_ADDR, MASTER_PORT. NCCL uses NVLink/PCIe.

**multi-node**:

```bash
rv run --gpu 4 --type a100 --time 2h -- torchrun --nproc_per_node=2 train.py
```

rv handles srun + torchrun coordination. NCCL uses InfiniBand across nodes. increase NCCL timeout for large models.

## process groups

NCCL for GPU tensors, Gloo for CPU tensors. using the wrong backend hangs silently.

```python
import torch.distributed as dist

dist.init_process_group("nccl")  # GPU training default

# for CPU collectives (gathering strings, dicts, metadata):
cpu_group = dist.new_group(backend="gloo")
dist.all_gather_object(output_list, my_dict, group=cpu_group)
```

you need Gloo for:

- gathering non-tensor objects (dicts, strings, reward metadata)
- CPU-only operations in RLHF (reward aggregation across nodes)
- any `all_gather_object` / `broadcast_object_list` call
- Ray actor communication that doesn't go through GPU

> common mistake: using NCCL for CPU tensors. it won't error — it just hangs forever.

## ddp

```python
model = DDP(model, device_ids=[local_rank])
```

footguns:

- **never call model.module.forward() directly** — bypasses gradient sync, causes hangs or wrong gradients
- if some parameters don't get gradients (multi-head, conditional branches): use `find_unused_parameters=True`
- `find_unused_parameters=True` adds overhead — only use when needed
- save with `model.module.state_dict()` (unwrap DDP), load into plain model, then re-wrap

activation checkpointing with DDP:

```python
class CheckpointedModel(nn.Module):
    def __init__(self, base):
        super().__init__()
        self.base = base
    def forward(self, x):
        return torch.utils.checkpoint.checkpoint(self.base, x, use_reentrant=False)

model = DDP(CheckpointedModel(base_model), device_ids=[local_rank])
```

data loading:

```python
sampler = DistributedSampler(dataset, shuffle=True)
loader = DataLoader(dataset, sampler=sampler, batch_size=per_gpu_batch)
for epoch in range(epochs):
    sampler.set_epoch(epoch)  # CRITICAL: different shuffle per epoch
```

## fsdp

### sharding strategies

| strategy      | what's sharded             | memory               | speed   |
| ------------- | -------------------------- | -------------------- | ------- |
| FULL_SHARD    | params + grads + optimizer | lowest (63% savings) | slowest |
| SHARD_GRAD_OP | grads + optimizer          | medium               | medium  |
| NO_SHARD      | nothing (same as DDP)      | highest              | fastest |

### wrapping policy

```python
# NEVER use always_wrap_policy — wraps every tiny layer, massive overhead
from torch.distributed.fsdp.wrap import size_based_auto_wrap_policy
import functools

auto_wrap_policy = functools.partial(
    size_based_auto_wrap_policy, min_num_params=1_000_000
)
model = FSDP(model, auto_wrap_policy=auto_wrap_policy, ...)
```

for transformer models, use `transformer_auto_wrap_policy` with your specific layer class.

### mixed precision with FSDP

```python
from torch.distributed.fsdp import MixedPrecision

mp_policy = MixedPrecision(
    param_dtype=torch.bfloat16,     # model params in bf16
    reduce_dtype=torch.float32,      # gradient reduction in fp32 (important!)
    buffer_dtype=torch.bfloat16,
)
model = FSDP(model, mixed_precision=mp_policy, ...)
```

### CPU offload

```python
from torch.distributed.fsdp import CPUOffload

model = FSDP(model, cpu_offload=CPUOffload(offload_params=True))
```

saves ~29% GPU memory but 26x slower in our tests. only use if model doesn't fit in GPU memory.

### state dict save/load

```python
from torch.distributed.fsdp import FullStateDictConfig, StateDictType

save_policy = FullStateDictConfig(offload_to_cpu=True, rank0_only=True)
with FSDP.state_dict_type(model, StateDictType.FULL_STATE_DICT, save_policy):
    state = model.state_dict()
    if rank == 0:
        torch.save(state, "model.pt")
```

these APIs are deprecated in favor of `torch.distributed.checkpoint`.

## mixed precision

- **BF16** (A100, H100, compute capability >= 8): wider exponent range, no GradScaler needed
- **FP16** (older GPUs): narrower range, must use GradScaler to prevent underflow/overflow

```python
# BF16 — simpler, preferred on modern GPUs
with torch.amp.autocast("cuda", dtype=torch.bfloat16):
    output = model(input)
    loss = loss_fn(output, target)
loss.backward()
optimizer.step()

# FP16 — needs GradScaler
scaler = torch.amp.GradScaler("cuda")
with torch.amp.autocast("cuda", dtype=torch.float16):
    output = model(input)
    loss = loss_fn(output, target)
scaler.scale(loss).backward()
scaler.step(optimizer)   # skips step if NaN detected
scaler.update()
```

> GradScaler automatically detects NaN/Inf gradients, skips the optimizer step, and decreases the scale factor. you don't need to check manually.

## checkpointing

### full checkpoint (model + optimizer + RNG)

```python
# save
checkpoint = {
    'model': model.module.state_dict(),   # unwrap DDP/FSDP
    'optimizer': optimizer.state_dict(),
    'epoch': epoch,
    'rng_cpu': torch.random.get_rng_state(),
    'rng_cuda': torch.cuda.get_rng_state(device),
    'loss_history': losses,
}
if rank == 0:
    torch.save(checkpoint, path)
dist.barrier()
```

### loading — watch the footguns

```python
# MUST use map_location='cpu' and weights_only=False
ckpt = torch.load(path, map_location='cpu', weights_only=False)
model.load_state_dict(ckpt['model'])
optimizer.load_state_dict(ckpt['optimizer'])

# RNG states need CPU ByteTensor
torch.random.set_rng_state(ckpt['rng_cpu'].cpu().to(torch.uint8))
torch.cuda.set_rng_state(ckpt['rng_cuda'].cpu().to(torch.uint8), device)
```

footguns:

- `weights_only=True` fails on optimizer states, RNG states, custom objects — use `weights_only=False`
- `map_location='cuda:0'` breaks RNG restore — use `map_location='cpu'`
- always save `model.module.state_dict()` (unwrapped), not `model.state_dict()` (DDP-wrapped)
- not saving optimizer state means Adam "forgets" momentum buffers after resume

> verified: 5+5 epoch resume produces identical loss to 10 straight epochs (0.00% difference). RNG state resume produces bit-identical random tensors.

## rlhf & grpo

### GRPO (Group Relative Policy Optimization)

```python
# generate G completions per prompt, normalize rewards within group
for prompt in prompts:
    completions = generate(model, prompt, num_samples=G)
    rewards = reward_fn(completions)
    advantages = (rewards - rewards.mean()) / (rewards.std() + 1e-8)

    # policy gradient with KL penalty
    log_probs = get_log_probs(model, completions)
    ref_log_probs = get_log_probs(ref_model, completions)  # frozen
    kl = (log_probs - ref_log_probs).mean()
    loss = -(log_probs * advantages).mean() + kl_coef * kl
```

critical footguns:

- reference model must be frozen: `ref_model.eval()` + never pass through optimizer
- advantages must be normalized within group (mean=0, std ~1)
- KL divergence is always non-negative
- multi-GPU: rewards and advantages must be synced across ranks

### TRL (Hugging Face)

```python
from trl import GRPOTrainer, GRPOConfig

config = GRPOConfig(
    output_dir="output",
    per_device_train_batch_size=4,
    num_generations=4,            # G in GRPO
    bf16=True,                    # use bf16 on A100
    fsdp="full_shard",            # for multi-GPU
    fsdp_config={"min_num_params": 1_000_000},
)
```

### OpenRLHF + Ray + vLLM

- uses Ray for actor/critic/reward model distribution, vLLM for fast generation
- need Gloo backend for CPU-based reward aggregation
- memory: actor + critic + reward model + ref model = 4x model size minimum
- vLLM: tensor_parallel_size must divide GPUs per node evenly
- Ray workers OOM with default Slurm memory — use 16GB minimum per CPU

```python
from vllm import LLM, SamplingParams

# vLLM manages its own GPU memory — don't mix with manual CUDA allocation
llm = LLM(model="meta-llama/Llama-2-7b", tensor_parallel_size=2)
```

## debugging

### hangs

1. **mismatched collectives**: one rank calls all_reduce, another doesn't — deadlock
2. **barrier without all ranks**: missing dist.barrier() on some ranks
3. **NCCL timeout**: increase with NCCL_TIMEOUT=1800 or in init_process_group
4. **data loader length mismatch**: different dataset sizes per rank — one rank finishes early

### OOM

1. **gradient accumulation**: reduce micro-batch size, accumulate gradients
2. **mixed precision**: bf16/fp16 halves activation memory
3. **activation checkpointing**: trades compute for memory
4. **FSDP FULL_SHARD**: shards everything across ranks (63% savings verified)
5. **CPU offload**: last resort, 10-30x slower

### wrong gradients

1. **DDP module bypass**: calling .module.forward() directly — no gradient sync
2. **forgetting model.train()**: BatchNorm uses running stats, Dropout disabled
3. **gradient accumulation without scaling**: divide loss by accumulation steps
4. **GradScaler skipping steps silently**: check scaler.get_scale() changes

### reproducibility

```python
torch.manual_seed(42)
torch.cuda.manual_seed_all(42)
torch.backends.cudnn.deterministic = True   # slower but reproducible
torch.backends.cudnn.benchmark = False
```
