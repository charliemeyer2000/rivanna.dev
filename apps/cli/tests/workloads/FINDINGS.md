# Phase 11: Hardening Test Findings

## Test 1: GPU Sanity (MIG)

**Date**: 2026-02-18
**Command**: `rv run check.py --mig --time 10m`
**Result**: PASS (after 3 attempts to fix bugs)
**Allocation time**: ~20s queue wait
**GPU type allocated**: NVIDIA A100-SXM4-80GB MIG 1g.10gb (10.2 GB VRAM)
**Node**: udc-an37-1
**Bugs found**:

- **BUG-1** (Critical): `QOSMaxCpuPerJobLimit` — MIG jobs failed because `--cpus-per-task` was never set, and auto-memory of 54G caused Slurm to request too many CPUs. **FIXED**: Set `cpusPerTask=1` for MIG, `16G` memory cap.
- **BUG-2** (Critical): Fast jobs completing between monitor polls were marked as FAILED because they vanished from `squeue`. **FIXED**: Added `sacct` fallback check for vanished jobs.
- **BUG-3** (Minor): Test script used `total_mem` instead of `total_memory` (PyTorch API change). Fixed test script.
  **CLI improvements needed**:
- `cpusPerTask` now set for all strategies (MIG=1, others=gpusPerNode\*4, max 32)
- MIG memory capped at 16G instead of proportional (which gave 54G on 2TB node)
  **Notes**:
- PyTorch 2.10.0+cu128 installed via uv (from UV_CACHE_DIR)
- RV_CHECKPOINT_DIR and HF_HOME correctly set on scratch
- CUDA matmul verified working

---

## Test 2: vLLM Serve (A6000)

**Date**: 2026-02-18
**Command**: `rv run serve.py --type a6000 --time 30m --mem 32G`
**Result**: PASS
**Allocation time**: ~5 min (includes dep install + queue)
**GPU type allocated**: A6000 (48GB VRAM)
**Node**: udc-an38-13
**Bugs found**:

- None for the CLI itself
  **CLI improvements needed**:
- vLLM writes torch compile cache to `~/.cache/vllm/` (HOME dir) instead of scratch. Could fill home quota. Consider setting `VLLM_CACHE_DIR` env var in template.
  **Notes**:
- vLLM v0.11.2 installed successfully with `--only-binary :all:` (no build issues)
- TinyLlama loaded in ~6.7s, 2.05 GiB GPU memory
- 35.47 GiB KV cache available on A6000
- All 3 generation prompts produced coherent output
- HF_HOME correctly used for model cache on scratch

---

## Test 3: Fan-Out Allocation (dry-run)

**Date**: 2026-02-18
**Commands**: All dry-runs completed
**Result**: PASS

### Results:

- **2 GPUs, 30m**: 7 strategies. RTX 3090 backfill (~10s), A40/A100_40 backfill (~30s), others direct (~1440m)
- **4 GPUs, 30m**: 12 strategies. Both single-node and multi-node (2x2) for all GPU types. No backfill available.
- **4x A100, 30m**: 2 strategies (A100_80 only — `--type a100` maps to a100_80). Single-node + multi-node.
- **8 GPUs, 1h**: 9 strategies. V100 multi-node only. A6000+ single + multi-node. No H200 (max 4/node).
- **8 GPUs, 24h**: 9 strategies. Same structure as 1h. No checkpoint strategies generated.
- **2x H200, 30m**: 1 strategy (direct only)

**Bugs found**:

- None
  **CLI improvements needed**:
- No checkpoint strategies generated for 24h requests because no backfill windows found for 4+ GPU requests. This is correct behavior (checkpoint requires backfill window > 0).
- Wait estimates show ~1440m for all non-backfillable strategies — this is the pessimistic cap. Consider showing "unknown" or "long" instead.
  **Notes**:
- Multi-node strategies (2x2, 2x4) generated correctly alongside single-node
- H200 correctly excluded from 8-GPU strategies (max 4 per node)
- A100 alias maps to A100_80 only (not A100_40) — intentional

---

## Test 4: DDP Training (4x GPU)

**Date**: 2026-02-18/19
**Command**: `rv up --gpu 4 --time 30m --run "torchrun --nproc_per_node=4 train.py"`
**Result**: PASS (after smart execution fix)
**Allocation time**: 373.1s (fan-out across all GPU types)
**GPU type allocated**: 4x A6000 on udc-an38-25
**Bugs found**:

- **BUG-4** (Critical): Smart execution only checked `commandArgs[0]` for local file. When command was `torchrun --nproc_per_node=4 train.py`, `torchrun` wasn't detected as a file, so no sync/workDir was set. `train.py` was looked for in HOME dir. **FIXED**: Now scans all non-flag args for local files, supports launchers like torchrun/accelerate/deepspeed.
  **CLI improvements needed**:
- Multi-node topology warnings shown for single-node allocation (cosmetic display bug)
  **Notes**:
- All 4 ranks initialized correctly (cuda:0-3 on udc-an38-25)
- Training loss decreased: 2.33 → 2.24 over 5 epochs
- Checkpoint saved to RV_CHECKPOINT_DIR on scratch (141.3 KB)
- `torchrun` used from `~/.local/bin/torchrun` (globally installed)
- PCIe topology warning correctly shown for A6000

---

## Test 5: Multi-Node Distributed (2x4 A100)

**Date**: 2026-02-19 (attempted)
**Command**: `rv run "torchrun --nproc_per_node=4 --nnodes=1 train_multinode.py" --gpu 4 --time 10m`
**Result**: DEFERRED (cluster fully loaded, all 12 strategies pending 5+ min)
**Bugs found (code review)**:

- **BUG-10** (High): Multi-node template missing `NODE_RANK=$SLURM_PROCID` — torchrun can't discover its node rank. **FIXED**: Added `export NODE_RANK=$SLURM_PROCID` to multi-node.ts.
  **Notes**:
- Dry-run generates correct strategies: both single-node (4x) and multi-node (2x2) for V100, A6000, A40, A100_40, A100_80, H200
- 9 strategies for 8-GPU request, correctly excluding H200 multi-node (max 4/node)
- Real multi-node test deferred until cluster has available GPUs

---

## Test 6: FSDP Training (4x GPU)

**Date**: 2026-02-19
**Command**: `rv up --gpu 4 --time 30m --run "torchrun --nproc_per_node=4 train_fsdp.py"`
**Result**: PASS
**Allocation time**: 11.4s (fan-out, V100 strategy won)
**GPU type allocated**: 4x A6000 (mismatch: strategy was V100)
**Node**: udc-an38-25
**Bugs found**:

- GPU mismatch: V100 strategy allocated but node has A6000 GPUs. The `--gres=gpu:v100:4` on the gpu-v100 partition allocated a node with A6000s. This is a Slurm/partition config issue, not a CLI bug. The CLI correctly detects and warns about the mismatch.
  **Notes**:
- FSDP wrapped TinyLlama-1.1B successfully across 4 GPUs
- Training loss dropped from 1.61 to 0.09 over 10 steps (bf16)
- `transformers` installed successfully with `--only-binary :all:`
- HF_HOME correctly used for model cache on scratch
- Checkpoint directory created correctly
- Multi-node warnings displayed (cosmetic bug — same as Test 4)

---

## Test 7: H200 Allocation

**Date**: 2026-02-18
**Command**: `rv up --gpu 2 --type h200 --time 30m --dry-run`
**Result**: PASS (dry-run only)
**Bugs found**:

- None
  **Notes**:
- H200 strategy generated correctly (1 strategy: 2x H200, direct, 817 SU)
- No backfill available
- H200 has 0 available GPUs currently (100% utilization) — real allocation would queue

---

## Test 8: CPU/Network Speed

**Date**: 2026-02-18
**Commands**: `rv exec` for disk write and network download
**Result**: PASS
**Bugs found**:

- None
  **Notes**:
- **Scratch write speed: 1.5 GB/s** (Weka filesystem)
- **Network download: 114 MB/s** (~912 Mbps, nearly gigabit)
- `rv exec` works correctly for login-node commands
- Internet reachable from login nodes

---

## Test 9: Checkpoint-Restart Cycle

**Date**: 2026-02-19 (template verified)
**Command**: `rv up --gpu 2 --time 12h --dry-run` (checkpoint strategy verification)
**Result**: PARTIAL — template verified, live test deferred
**Bugs found (code review)**:

- **BUG-8** (High): Checkpoint strategies were pruned by `rankStrategies()` — `direct+timemin` dominated checkpoint strategies with same SU/wait. **FIXED**: Never prune across checkpoint/non-checkpoint strategy types.
- **BUG-9** (Medium): `TIMEOUT=$((WALLTIME_SECONDS - BUFFER_SECONDS))` could go negative for very short backfill windows. **FIXED**: Floor at 60s with warning.
  **Notes**:
- Single A6000 is fully backfillable (up to 12h+), so checkpoint strategies never generated for 1-GPU A6000
- Checkpoint strategies now correctly appear for 2x A40/A100_40 with 12h request (240m backfill ceiling)
- Live checkpoint cycle test requires cluster load that produces short backfill windows
- Template correctly handles: SIGUSR1 signal, RV_TOTAL_ELAPSED tracking, sbatch resubmission

---

## Test 10: Multiprocessing & DataLoader

**Date**: 2026-02-18/19
**Command**: `rv run dataload.py --mig --time 10m`
**Result**: PASS (after fixing test script and sacct lag)
**Allocation time**: ~15s
**GPU type allocated**: MIG 1g.10gb
**Node**: udc-an37-1
**Bugs found**:

- **BUG-5** (High): Monitor marked vanished jobs as FAILED when sacct had no record yet (accounting daemon lag). **FIXED**: Only mark as FAILED if sacct has a terminal record; leave unchanged if no record found.
- Test script bug: nested function can't be pickled. Fixed by moving to module level.
  **CLI improvements needed**:
- `OMP_NUM_THREADS=1` correctly set (verified in output)
- `SLURM_CPUS_PER_TASK=2` set (Slurm auto-adjusted from 1 to satisfy 16G memory)
- PyTorch warns "suggested max workers is 2" when num_workers > SLURM_CPUS_PER_TASK — correct behavior
  **Notes**:
- CPUs visible: 128 (entire node visible, but cgroup limits apply)
- DataLoader: workers 0=1.22s, 2=0.71s, 4=0.66s, 8=0.74s
- multiprocessing.Pool: sum of squares = 328350 (correct)
- Workers > CPUS_PER_TASK still work (not cgroup-killed), just trigger PyTorch warning

---

## Test 11: MoE Inference (Mixtral)

**Date**: pending
**Command**: `rv up --gpu 4 --type a100 --time 1h --run "python moe_test.py" --mem 128G`
**Result**: pending

---

## Summary

### Bugs Found

| #   | Bug                                                               | Severity | Test        | Fixed? |
| --- | ----------------------------------------------------------------- | -------- | ----------- | ------ |
| 1   | MIG QOSMaxCpuPerJobLimit — no cpusPerTask set                     | Critical | #1          | Yes    |
| 2   | Fast jobs vanish from squeue, monitor marks as FAILED             | Critical | #1          | Yes    |
| 3   | Smart execution only checks first arg for local file              | Critical | #4          | Yes    |
| 4   | OMP_NUM_THREADS not set — CPU oversubscription risk               | High     | #10         | Yes    |
| 5   | TOKENIZERS_PARALLELISM not set — warning spam                     | Medium   | -           | Yes    |
| 6   | MIG auto-memory too high (54G on 2TB node)                        | High     | #1          | Yes    |
| 7   | sacct lag — vanished jobs marked FAILED before accounting updates | High     | #10         | Yes    |
| 8   | Checkpoint strategies pruned by direct+timemin (same SU/wait)     | High     | #3          | Yes    |
| 9   | Checkpoint TIMEOUT can go negative if walltime < buffer           | Medium   | code review | Yes    |
| 10  | Multi-node template missing NODE_RANK for torchrun                | High     | code review | Yes    |

### CLI Improvements Made

| #   | Improvement                                                      | Test        |
| --- | ---------------------------------------------------------------- | ----------- |
| 1   | Set VLLM_CACHE_DIR to scratch (avoid home quota)                 | #2          |
| 2   | Add SACCT NodeList to job history for tracking                   | #1          |
| 3   | Set cpusPerTask (MIG=1, others=gpusPerNode\*4)                   | #1          |
| 4   | Set OMP_NUM_THREADS and TOKENIZERS_PARALLELISM                   | #10         |
| 5   | Checkpoint pruning: never prune across checkpoint/non-checkpoint | #3          |
| 6   | Checkpoint TIMEOUT floor at 60s with warning                     | code review |
| 7   | Multi-node: set NODE_RANK=$SLURM_PROCID for torchrun             | code review |

### Remaining Improvements

| #   | Improvement                                             | Priority | Test   |
| --- | ------------------------------------------------------- | -------- | ------ |
| 1   | Multi-node warnings shown for single-node allocations   | Low      | #4, #6 |
| 2   | Show "unknown" instead of "~1440m" for non-backfillable | Low      | #3     |
| 3   | GPU mismatch: V100 partition allocates A6000 nodes      | Info     | #6     |

### Performance Baselines

| Metric                    | Value                | Notes                       |
| ------------------------- | -------------------- | --------------------------- |
| MIG allocation time       | ~15-20s              | Queue wait, allocation fast |
| A6000 allocation time     | 11-373s              | Varies with cluster load    |
| A100 allocation time      | pending              |                             |
| H200 allocation time      | pending              | 100% utilization currently  |
| Scratch write speed       | 1.5 GB/s             | Weka filesystem, dd test    |
| Network download speed    | 114 MB/s (~912 Mbps) | Cloudflare speed test       |
| Cross-node NCCL bandwidth | pending              |                             |
