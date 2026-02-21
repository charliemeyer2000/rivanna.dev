import { Metadata } from "next";
import { CodeBlock } from "../_components/code-block";

export const metadata: Metadata = {
  title: "gpu training | rivanna.dev docs",
  description:
    "distributed training best practices for DDP, FSDP, mixed precision, checkpointing, and RLHF on Rivanna",
};

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-orange-accent bg-orange-accent/5 px-4 py-2 text-sm text-gray-700">
      {children}
    </div>
  );
}

function StrategyTable() {
  const rows = [
    {
      strategy: "FULL_SHARD",
      sharded: "params + grads + optimizer",
      memory: "lowest (63% savings)",
      speed: "slowest",
    },
    {
      strategy: "SHARD_GRAD_OP",
      sharded: "grads + optimizer",
      memory: "medium",
      speed: "medium",
    },
    {
      strategy: "NO_SHARD",
      sharded: "nothing (same as DDP)",
      memory: "highest",
      speed: "fastest",
    },
  ];
  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-sm border border-gray-200">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="px-3 py-2 border-b border-gray-200 font-medium">
              strategy
            </th>
            <th className="px-3 py-2 border-b border-gray-200 font-medium">
              what&apos;s sharded
            </th>
            <th className="px-3 py-2 border-b border-gray-200 font-medium">
              memory
            </th>
            <th className="px-3 py-2 border-b border-gray-200 font-medium">
              speed
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.strategy} className="border-b border-gray-100">
              <td className="px-3 py-2 font-mono text-xs">{r.strategy}</td>
              <td className="px-3 py-2 text-gray-600">{r.sharded}</td>
              <td className="px-3 py-2 text-gray-600">{r.memory}</td>
              <td className="px-3 py-2 text-gray-600">{r.speed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function GpuTrainingPage() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-semibold mb-4">gpu training</h2>
        <p className="text-gray-600 mb-2">
          best practices for distributed training on Rivanna. covers DDP, FSDP,
          mixed precision, checkpointing, RLHF, and common debugging patterns.
        </p>
        <p className="text-sm text-gray-500">
          everything here was verified on Rivanna across 10 test suites (52/53
          passed) using A6000, A100, and MIG GPUs.
        </p>
      </section>

      {/* ── Overview ─────────────────────────────────────────────── */}
      <section
        id="overview"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">overview</h3>
        <p className="text-sm text-gray-600">
          pick the right setup for your workload:
        </p>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-black mb-1">
              single GPU (MIG or dedicated)
            </p>
            <CodeBlock>
              <code className="text-sm text-black">
                {`# free MIG slice — good for testing
rv run --mig --time 10m -- python train.py

# dedicated GPU
rv run --gpu 1 --type a6000 --time 1h -- python train.py`}
              </code>
            </CodeBlock>
            <p className="text-xs text-gray-500 mt-1">
              no torchrun, no init_process_group. use torch.amp.autocast for
              mixed precision.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-black mb-1">
              multi-GPU, single node (DDP/FSDP)
            </p>
            <CodeBlock>
              <code className="text-sm text-black">
                rv run --gpu 2 --type a6000 --time 1h -- torchrun
                --nproc_per_node=2 train.py
              </code>
            </CodeBlock>
            <p className="text-xs text-gray-500 mt-1">
              torchrun sets RANK, LOCAL_RANK, WORLD_SIZE, MASTER_ADDR,
              MASTER_PORT. NCCL uses NVLink/PCIe.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-black mb-1">multi-node</p>
            <CodeBlock>
              <code className="text-sm text-black">
                rv run --gpu 4 --type a100 --time 2h -- torchrun
                --nproc_per_node=2 train.py
              </code>
            </CodeBlock>
            <p className="text-xs text-gray-500 mt-1">
              rv handles srun + torchrun coordination. NCCL uses InfiniBand
              across nodes. increase NCCL timeout for large models.
            </p>
          </div>
        </div>

        <Tip>
          BF16 on A100/H100 (compute capability {">"}= 8), FP16 on older GPUs
          (A6000, V100).
        </Tip>
      </section>

      {/* ── Process Groups ───────────────────────────────────────── */}
      <section
        id="process-groups"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">process groups</h3>
        <p className="text-sm text-gray-600">
          NCCL for GPU tensors, Gloo for CPU tensors. using the wrong backend
          hangs silently.
        </p>

        <CodeBlock>
          <code className="text-sm text-black">
            {`import torch.distributed as dist

dist.init_process_group("nccl")  # GPU training default

# for CPU collectives (gathering strings, dicts, metadata):
cpu_group = dist.new_group(backend="gloo")
dist.all_gather_object(output_list, my_dict, group=cpu_group)`}
          </code>
        </CodeBlock>

        <p className="text-sm text-gray-600">you need Gloo for:</p>
        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
          <li>
            gathering non-tensor objects (dicts, strings, reward metadata)
          </li>
          <li>CPU-only operations in RLHF (reward aggregation across nodes)</li>
          <li>
            any{" "}
            <code className="text-xs bg-gray-100 px-1">all_gather_object</code>{" "}
            /{" "}
            <code className="text-xs bg-gray-100 px-1">
              broadcast_object_list
            </code>{" "}
            call
          </li>
          <li>Ray actor communication that doesn&apos;t go through GPU</li>
        </ul>

        <Tip>
          common mistake: using NCCL for CPU tensors. it won&apos;t error — it
          just hangs forever.
        </Tip>
      </section>

      {/* ── DDP ──────────────────────────────────────────────────── */}
      <section id="ddp" className="border border-gray-200 p-4 sm:p-6 space-y-4">
        <h3 className="text-lg font-semibold text-black">
          DDP (DistributedDataParallel)
        </h3>

        <CodeBlock>
          <code className="text-sm text-black">
            {`model = DDP(model, device_ids=[local_rank])`}
          </code>
        </CodeBlock>

        <div>
          <p className="text-sm font-medium text-black mb-2">footguns</p>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
            <li>
              <strong>never call model.module.forward() directly</strong> —
              bypasses gradient sync, causes hangs or wrong gradients
            </li>
            <li>
              if some parameters don&apos;t get gradients (multi-head,
              conditional branches): use{" "}
              <code className="text-xs bg-gray-100 px-1">
                find_unused_parameters=True
              </code>
            </li>
            <li>
              <code className="text-xs bg-gray-100 px-1">
                find_unused_parameters=True
              </code>{" "}
              adds overhead — only use when needed
            </li>
            <li>
              save with{" "}
              <code className="text-xs bg-gray-100 px-1">
                model.module.state_dict()
              </code>{" "}
              (unwrap DDP), load into plain model, then re-wrap
            </li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">
            activation checkpointing with DDP
          </p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`class CheckpointedModel(nn.Module):
    def __init__(self, base):
        super().__init__()
        self.base = base
    def forward(self, x):
        return torch.utils.checkpoint.checkpoint(self.base, x, use_reentrant=False)

model = DDP(CheckpointedModel(base_model), device_ids=[local_rank])`}
            </code>
          </CodeBlock>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">data loading</p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`sampler = DistributedSampler(dataset, shuffle=True)
loader = DataLoader(dataset, sampler=sampler, batch_size=per_gpu_batch)
for epoch in range(epochs):
    sampler.set_epoch(epoch)  # CRITICAL: different shuffle per epoch`}
            </code>
          </CodeBlock>
        </div>
      </section>

      {/* ── FSDP ─────────────────────────────────────────────────── */}
      <section
        id="fsdp"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">
          FSDP (Fully Sharded Data Parallel)
        </h3>

        <div>
          <p className="text-sm font-medium text-black mb-2">
            sharding strategies
          </p>
          <StrategyTable />
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">wrapping policy</p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`# NEVER use always_wrap_policy — wraps every tiny layer, massive overhead
from torch.distributed.fsdp.wrap import size_based_auto_wrap_policy
import functools

auto_wrap_policy = functools.partial(
    size_based_auto_wrap_policy, min_num_params=1_000_000
)
model = FSDP(model, auto_wrap_policy=auto_wrap_policy, ...)`}
            </code>
          </CodeBlock>
          <p className="text-xs text-gray-500 mt-2">
            for transformer models, use{" "}
            <code className="text-xs bg-gray-100 px-1">
              transformer_auto_wrap_policy
            </code>{" "}
            with your specific layer class.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">
            mixed precision with FSDP
          </p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`from torch.distributed.fsdp import MixedPrecision

mp_policy = MixedPrecision(
    param_dtype=torch.bfloat16,     # model params in bf16
    reduce_dtype=torch.float32,      # gradient reduction in fp32 (important!)
    buffer_dtype=torch.bfloat16,
)
model = FSDP(model, mixed_precision=mp_policy, ...)`}
            </code>
          </CodeBlock>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">CPU offload</p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`from torch.distributed.fsdp import CPUOffload

model = FSDP(model, cpu_offload=CPUOffload(offload_params=True))`}
            </code>
          </CodeBlock>
          <p className="text-xs text-gray-500 mt-2">
            saves ~29% GPU memory but 26x slower in our tests. only use if model
            doesn&apos;t fit in GPU memory.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">
            state dict save/load
          </p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`from torch.distributed.fsdp import FullStateDictConfig, StateDictType

save_policy = FullStateDictConfig(offload_to_cpu=True, rank0_only=True)
with FSDP.state_dict_type(model, StateDictType.FULL_STATE_DICT, save_policy):
    state = model.state_dict()
    if rank == 0:
        torch.save(state, "model.pt")`}
            </code>
          </CodeBlock>
          <p className="text-xs text-gray-500 mt-2">
            these APIs are deprecated in favor of torch.distributed.checkpoint.
          </p>
        </div>
      </section>

      {/* ── Mixed Precision ──────────────────────────────────────── */}
      <section
        id="mixed-precision"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">mixed precision</h3>

        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
          <li>
            <strong>BF16</strong> (A100, H100, compute capability {">"}= 8):
            wider exponent range, no GradScaler needed
          </li>
          <li>
            <strong>FP16</strong> (older GPUs): narrower range, must use
            GradScaler to prevent underflow/overflow
          </li>
        </ul>

        <CodeBlock>
          <code className="text-sm text-black">
            {`# BF16 — simpler, preferred on modern GPUs
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
scaler.update()`}
          </code>
        </CodeBlock>

        <Tip>
          GradScaler automatically detects NaN/Inf gradients, skips the
          optimizer step, and decreases the scale factor. you don&apos;t need to
          check manually.
        </Tip>
      </section>

      {/* ── Checkpointing ────────────────────────────────────────── */}
      <section
        id="checkpointing"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">
          checkpointing &amp; resume
        </h3>

        <div>
          <p className="text-sm font-medium text-black mb-2">
            full checkpoint (model + optimizer + RNG)
          </p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`# save
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
dist.barrier()`}
            </code>
          </CodeBlock>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">
            loading — watch the footguns
          </p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`# MUST use map_location='cpu' and weights_only=False
ckpt = torch.load(path, map_location='cpu', weights_only=False)
model.load_state_dict(ckpt['model'])
optimizer.load_state_dict(ckpt['optimizer'])

# RNG states need CPU ByteTensor
torch.random.set_rng_state(ckpt['rng_cpu'].cpu().to(torch.uint8))
torch.cuda.set_rng_state(ckpt['rng_cuda'].cpu().to(torch.uint8), device)`}
            </code>
          </CodeBlock>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">footguns</p>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
            <li>
              <code className="text-xs bg-gray-100 px-1">
                weights_only=True
              </code>{" "}
              fails on optimizer states, RNG states, custom objects — use{" "}
              <code className="text-xs bg-gray-100 px-1">
                weights_only=False
              </code>
            </li>
            <li>
              <code className="text-xs bg-gray-100 px-1">
                map_location=&apos;cuda:0&apos;
              </code>{" "}
              breaks RNG restore — use{" "}
              <code className="text-xs bg-gray-100 px-1">
                map_location=&apos;cpu&apos;
              </code>
            </li>
            <li>
              always save{" "}
              <code className="text-xs bg-gray-100 px-1">
                model.module.state_dict()
              </code>{" "}
              (unwrapped), not{" "}
              <code className="text-xs bg-gray-100 px-1">
                model.state_dict()
              </code>{" "}
              (DDP-wrapped)
            </li>
            <li>
              not saving optimizer state means Adam &quot;forgets&quot; momentum
              buffers after resume
            </li>
          </ul>
        </div>

        <Tip>
          verified: 5+5 epoch resume produces identical loss to 10 straight
          epochs (0.00% difference). RNG state resume produces bit-identical
          random tensors.
        </Tip>
      </section>

      {/* ── RLHF ────────────────────────────────────────────────── */}
      <section
        id="rlhf"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">RLHF &amp; GRPO</h3>

        <div>
          <p className="text-sm font-medium text-black mb-2">
            GRPO (Group Relative Policy Optimization)
          </p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`# generate G completions per prompt, normalize rewards within group
for prompt in prompts:
    completions = generate(model, prompt, num_samples=G)
    rewards = reward_fn(completions)
    advantages = (rewards - rewards.mean()) / (rewards.std() + 1e-8)

    # policy gradient with KL penalty
    log_probs = get_log_probs(model, completions)
    ref_log_probs = get_log_probs(ref_model, completions)  # frozen
    kl = (log_probs - ref_log_probs).mean()
    loss = -(log_probs * advantages).mean() + kl_coef * kl`}
            </code>
          </CodeBlock>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">
            critical footguns
          </p>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
            <li>
              reference model must be frozen:{" "}
              <code className="text-xs bg-gray-100 px-1">ref_model.eval()</code>{" "}
              + never pass through optimizer
            </li>
            <li>
              advantages must be normalized within group (mean=0, std approx 1)
            </li>
            <li>KL divergence is always non-negative</li>
            <li>
              multi-GPU: rewards and advantages must be synced across ranks
            </li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">
            TRL (Hugging Face)
          </p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`from trl import GRPOTrainer, GRPOConfig

config = GRPOConfig(
    output_dir="output",
    per_device_train_batch_size=4,
    num_generations=4,            # G in GRPO
    bf16=True,                    # use bf16 on A100
    fsdp="full_shard",            # for multi-GPU
    fsdp_config={"min_num_params": 1_000_000},
)`}
            </code>
          </CodeBlock>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">
            OpenRLHF + Ray + vLLM
          </p>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
            <li>
              uses Ray for actor/critic/reward model distribution, vLLM for fast
              generation
            </li>
            <li>need Gloo backend for CPU-based reward aggregation</li>
            <li>
              memory: actor + critic + reward model + ref model = 4x model size
              minimum
            </li>
            <li>vLLM: tensor_parallel_size must divide GPUs per node evenly</li>
            <li>
              Ray workers OOM with default Slurm memory — use 16GB minimum per
              CPU
            </li>
          </ul>
          <CodeBlock className="mt-2">
            <code className="text-sm text-black">
              {`from vllm import LLM, SamplingParams

# vLLM manages its own GPU memory — don't mix with manual CUDA allocation
llm = LLM(model="meta-llama/Llama-2-7b", tensor_parallel_size=2)`}
            </code>
          </CodeBlock>
        </div>
      </section>

      {/* ── Debugging ────────────────────────────────────────────── */}
      <section
        id="debugging"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">
          debugging distributed training
        </h3>

        <div>
          <p className="text-sm font-medium text-black mb-2">hangs</p>
          <ul className="text-sm text-gray-600 list-decimal pl-5 space-y-1">
            <li>
              <strong>mismatched collectives</strong>: one rank calls
              all_reduce, another doesn&apos;t — deadlock
            </li>
            <li>
              <strong>barrier without all ranks</strong>: missing dist.barrier()
              on some ranks
            </li>
            <li>
              <strong>NCCL timeout</strong>: increase with NCCL_TIMEOUT=1800 or
              in init_process_group
            </li>
            <li>
              <strong>data loader length mismatch</strong>: different dataset
              sizes per rank — one rank finishes early
            </li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">OOM</p>
          <ul className="text-sm text-gray-600 list-decimal pl-5 space-y-1">
            <li>
              <strong>gradient accumulation</strong>: reduce micro-batch size,
              accumulate gradients
            </li>
            <li>
              <strong>mixed precision</strong>: bf16/fp16 halves activation
              memory
            </li>
            <li>
              <strong>activation checkpointing</strong>: trades compute for
              memory
            </li>
            <li>
              <strong>FSDP FULL_SHARD</strong>: shards everything across ranks
              (63% savings verified)
            </li>
            <li>
              <strong>CPU offload</strong>: last resort, 10-30x slower
            </li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">wrong gradients</p>
          <ul className="text-sm text-gray-600 list-decimal pl-5 space-y-1">
            <li>
              <strong>DDP module bypass</strong>: calling .module.forward()
              directly — no gradient sync
            </li>
            <li>
              <strong>forgetting model.train()</strong>: BatchNorm uses running
              stats, Dropout disabled
            </li>
            <li>
              <strong>gradient accumulation without scaling</strong>: divide
              loss by accumulation steps
            </li>
            <li>
              <strong>GradScaler skipping steps silently</strong>: check
              scaler.get_scale() changes
            </li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">reproducibility</p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`torch.manual_seed(42)
torch.cuda.manual_seed_all(42)
torch.backends.cudnn.deterministic = True   # slower but reproducible
torch.backends.cudnn.benchmark = False`}
            </code>
          </CodeBlock>
        </div>
      </section>
    </div>
  );
}
