import { Metadata } from "next";
import { CodeBlock } from "../_components/code-block";

export const metadata: Metadata = {
  title: "guides | rivanna.dev docs",
  description:
    "GPU training best practices, common tips, and troubleshooting for rv CLI on Rivanna",
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

export default function GuidesPage() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-semibold mb-4">guides</h2>
        <p className="text-gray-600 mb-2">
          tips, GPU training best practices, and troubleshooting — all verified
          on Rivanna.
        </p>
      </section>

      {/* ── Tips & Gotchas ─────────────────────────────────────── */}
      <section
        id="tips"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">tips & gotchas</h3>

        <div>
          <p className="text-sm font-medium text-black mb-1">
            argument ordering
          </p>
          <p className="text-sm text-gray-600">
            rv options must come <strong>before</strong> the command. anything
            after is passed through. rv warns if it detects misplaced flags.
          </p>
          <div className="mt-2 space-y-1 text-sm font-mono">
            <p className="text-green-700">
              rv run -g 4 -t a100 python train.py ✓
            </p>
            <p className="text-red-600">
              rv run python train.py -g 4 -t a100 ✗
            </p>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-1">file sync</p>
          <p className="text-sm text-gray-600">
            <code className="text-orange-accent">rv run</code> uploads your
            current directory. only git-tracked files sync. each job gets an
            immutable snapshot. use{" "}
            <code className="text-orange-accent">.rvignore</code> to exclude
            extra files.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-1">
            output buffering
          </p>
          <p className="text-sm text-gray-600">
            rv auto-sets{" "}
            <code className="text-orange-accent">PYTHONUNBUFFERED=1</code>. if
            you still see no output, check{" "}
            <code className="text-orange-accent">rv logs --err</code> — the job
            may have crashed.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-1">
            rv exec is login-node only
          </p>
          <p className="text-sm text-gray-600">
            no GPU access. use for file checks and queries. for GPU utilization,
            use <code className="text-orange-accent">rv gpu</code>.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-1">
            backfill scheduling
          </p>
          <p className="text-sm text-gray-600">
            jobs under 3 hours qualify for backfill — often near-instant
            allocation. the default walltime (2:59:00) is set just below this
            threshold.
          </p>
        </div>
      </section>

      {/* ── Queue Times ────────────────────────────────────────── */}
      <section
        id="queue-times"
        className="border border-gray-200 p-4 sm:p-6 space-y-3"
      >
        <h3 className="text-lg font-semibold text-black">queue times</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-gray-200">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  GPU
                </th>
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  typical wait
                </th>
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  SU/GPU-hr
                </th>
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  VRAM
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                { gpu: "mig", wait: "instant", su: "FREE", vram: "10 GB" },
                { gpu: "v100", wait: "~3 days", su: "21", vram: "32 GB" },
                { gpu: "a6000", wait: "~18 hours", su: "143", vram: "48 GB" },
                { gpu: "a100", wait: "~10 hours", su: "509", vram: "80 GB" },
                { gpu: "h200", wait: "varies", su: "817", vram: "141 GB" },
              ].map((r) => (
                <tr key={r.gpu} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-mono text-xs">{r.gpu}</td>
                  <td className="px-3 py-2 text-gray-600">{r.wait}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{r.su}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{r.vram}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">
          check real-time availability with{" "}
          <code className="text-orange-accent">rv status</code>.
        </p>
      </section>

      {/* ── Training Overview ──────────────────────────────────── */}
      <section
        id="overview"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">training overview</h3>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-black mb-1">single GPU</p>
            <CodeBlock>
              <code className="text-sm text-black">
                {`rv run --mig python train.py              # free MIG slice
rv run -g 1 -t a6000 python train.py      # dedicated GPU`}
              </code>
            </CodeBlock>
          </div>

          <div>
            <p className="text-sm font-medium text-black mb-1">
              multi-GPU (DDP/FSDP)
            </p>
            <CodeBlock>
              <code className="text-sm text-black">
                rv run -g 2 -t a6000 -- torchrun --nproc_per_node=2 train.py
              </code>
            </CodeBlock>
          </div>

          <div>
            <p className="text-sm font-medium text-black mb-1">multi-node</p>
            <CodeBlock>
              <code className="text-sm text-black">
                rv run -g 4 -t a100 -- torchrun --nproc_per_node=2 train.py
              </code>
            </CodeBlock>
            <p className="text-xs text-gray-500 mt-1">
              rv handles srun + torchrun coordination automatically.
            </p>
          </div>
        </div>

        <Tip>
          BF16 on A100/H200 (compute capability {">"}= 8). FP16 + GradScaler on
          older GPUs.
        </Tip>
      </section>

      {/* ── Process Groups ───────────────────────────────────────── */}
      <section
        id="process-groups"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">process groups</h3>
        <p className="text-sm text-gray-600">
          NCCL for GPU tensors, Gloo for CPU tensors. wrong backend = silent
          hang.
        </p>

        <CodeBlock>
          <code className="text-sm text-black">
            {`dist.init_process_group("nccl")  # GPU default

# CPU collectives (strings, dicts, metadata):
cpu_group = dist.new_group(backend="gloo")
dist.all_gather_object(output_list, my_dict, group=cpu_group)`}
          </code>
        </CodeBlock>
      </section>

      {/* ── DDP ──────────────────────────────────────────────────── */}
      <section id="ddp" className="border border-gray-200 p-4 sm:p-6 space-y-4">
        <h3 className="text-lg font-semibold text-black">DDP</h3>

        <CodeBlock>
          <code className="text-sm text-black">
            model = DDP(model, device_ids=[local_rank])
          </code>
        </CodeBlock>

        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
          <li>
            never call{" "}
            <code className="text-xs bg-gray-100 px-1">
              model.module.forward()
            </code>{" "}
            directly — bypasses gradient sync
          </li>
          <li>
            <code className="text-xs bg-gray-100 px-1">
              find_unused_parameters=True
            </code>{" "}
            for conditional/multi-head models
          </li>
          <li>
            save with{" "}
            <code className="text-xs bg-gray-100 px-1">
              model.module.state_dict()
            </code>{" "}
            (unwrap DDP)
          </li>
          <li>
            <code className="text-xs bg-gray-100 px-1">
              sampler.set_epoch(epoch)
            </code>{" "}
            in every epoch for correct shuffling
          </li>
        </ul>
      </section>

      {/* ── FSDP ─────────────────────────────────────────────────── */}
      <section
        id="fsdp"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">FSDP</h3>

        <StrategyTable />

        <div>
          <p className="text-sm font-medium text-black mb-2">wrapping policy</p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`# NEVER use always_wrap_policy
from torch.distributed.fsdp.wrap import size_based_auto_wrap_policy
auto_wrap_policy = functools.partial(size_based_auto_wrap_policy, min_num_params=1_000_000)
model = FSDP(model, auto_wrap_policy=auto_wrap_policy, ...)`}
            </code>
          </CodeBlock>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">mixed precision</p>
          <CodeBlock>
            <code className="text-sm text-black">
              {`mp_policy = MixedPrecision(
    param_dtype=torch.bfloat16,
    reduce_dtype=torch.float32,  # gradient reduction in fp32
    buffer_dtype=torch.bfloat16,
)
model = FSDP(model, mixed_precision=mp_policy)`}
            </code>
          </CodeBlock>
        </div>

        <Tip>
          CPU offload saves ~29% GPU memory but is 26x slower. last resort only.
        </Tip>
      </section>

      {/* ── Mixed Precision ──────────────────────────────────────── */}
      <section
        id="mixed-precision"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">mixed precision</h3>

        <CodeBlock>
          <code className="text-sm text-black">
            {`# BF16 (A100/H200) — no GradScaler needed
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
scaler.update()`}
          </code>
        </CodeBlock>
      </section>

      {/* ── Checkpointing ────────────────────────────────────────── */}
      <section
        id="checkpointing"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">checkpointing</h3>

        <CodeBlock>
          <code className="text-sm text-black">
            {`# save (rank 0 only)
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
ckpt = torch.load(path, map_location='cpu', weights_only=False)`}
          </code>
        </CodeBlock>

        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
          <li>
            <code className="text-xs bg-gray-100 px-1">weights_only=True</code>{" "}
            fails on optimizer/RNG states
          </li>
          <li>
            <code className="text-xs bg-gray-100 px-1">
              map_location=&apos;cuda:0&apos;
            </code>{" "}
            breaks RNG restore
          </li>
          <li>
            always save{" "}
            <code className="text-xs bg-gray-100 px-1">
              model.module.state_dict()
            </code>{" "}
            (unwrapped)
          </li>
          <li>
            skipping optimizer state means Adam forgets momentum after resume
          </li>
        </ul>
      </section>

      {/* ── RLHF ────────────────────────────────────────────────── */}
      <section
        id="rlhf"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">RLHF &amp; GRPO</h3>

        <CodeBlock>
          <code className="text-sm text-black">
            {`# GRPO: generate G completions, normalize rewards within group
advantages = (rewards - rewards.mean()) / (rewards.std() + 1e-8)
loss = -(log_probs * advantages).mean() + kl_coef * kl`}
          </code>
        </CodeBlock>

        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
          <li>
            reference model must be frozen:{" "}
            <code className="text-xs bg-gray-100 px-1">ref_model.eval()</code>
          </li>
          <li>multi-GPU: sync rewards and advantages across ranks</li>
          <li>OpenRLHF needs Gloo for CPU reward aggregation</li>
          <li>memory: 4x model size minimum (actor + critic + reward + ref)</li>
        </ul>
      </section>

      {/* ── Debugging ────────────────────────────────────────────── */}
      <section
        id="debugging"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">debugging</h3>

        <div>
          <p className="text-sm font-medium text-black mb-2">hangs</p>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
            <li>mismatched collectives across ranks → deadlock</li>
            <li>
              missing{" "}
              <code className="text-xs bg-gray-100 px-1">dist.barrier()</code>{" "}
              on some ranks
            </li>
            <li>
              NCCL timeout — increase with{" "}
              <code className="text-xs bg-gray-100 px-1">
                NCCL_TIMEOUT=1800
              </code>
            </li>
            <li>data loader length mismatch — one rank finishes early</li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-black mb-2">OOM</p>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
            <li>gradient accumulation → smaller micro-batch</li>
            <li>mixed precision → halves activation memory</li>
            <li>activation checkpointing → trades compute for memory</li>
            <li>FSDP FULL_SHARD → 63% memory savings</li>
          </ul>
        </div>
      </section>

      {/* ── Troubleshooting ──────────────────────────────────────── */}
      <section
        id="troubleshooting"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">troubleshooting</h3>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-black">
              job stuck in PENDING
            </p>
            <p className="text-sm text-gray-600">
              check <code className="text-orange-accent">rv status</code>, try a
              different GPU type, use{" "}
              <code className="text-orange-accent">--mig</code> for instant free
              allocation, or reduce{" "}
              <code className="text-orange-accent">--time</code> below 3h for
              backfill.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-black">no output files</p>
            <p className="text-sm text-gray-600">
              check <code className="text-orange-accent">rv logs --err</code>{" "}
              for errors. write to{" "}
              <code className="text-orange-accent">/scratch/</code> not{" "}
              <code className="text-orange-accent">/tmp/</code> (node-local).
              the job CWD is the snapshot, not your live code.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-black">
              can&apos;t find results
            </p>
            <CodeBlock>
              <code className="text-sm text-black">
                {`rv exec "ls /scratch/USER/.rv/logs/"       # log files
rv exec "ls /scratch/USER/rv-workspaces/"  # synced code
rv sync pull /remote/path ./local/         # download`}
              </code>
            </CodeBlock>
          </div>
        </div>
      </section>
    </div>
  );
}
