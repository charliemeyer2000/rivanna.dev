# Rivanna CLI — Build Spec

---

## Agent Instructions

**Read this entire document before writing any code.**

Before starting any work:

1. Read this full PLAN.md to understand the project scope, architecture, and current state
2. Run `git log --oneline -20` to see what's been done
3. Explore the codebase: `ls`, check `package.json`, look at what exists in `apps/` and `packages/`
4. Check the **Agent Learnings** section below for notes from previous agents
5. Identify which **Implementation Phase** you're working on
6. Reference `~/all/uvacompute` for patterns — it's the sibling project we mirror

If multiple agents are working concurrently, coordinate through the **Agent Learnings** section. Before starting a phase, check if another agent has claimed it or left notes.

When using Claude Code plan mode: each **Implementation Phase** below is sized for one plan-mode session. Enter plan mode, read the phase spec, explore relevant reference code in `~/all/uvacompute`, build your plan, then implement.

---

## Agent Learnings

> Agents: add discoveries, gotchas, and decisions here as you build. This is shared state across all coding sessions. Keep entries concise. Prefix with date.

- 2026-02-18: pnpm workspaces (not bun) at root. Bun only for CLI build/compile.
- 2026-02-18: CI `bun install` must run from repo root, not apps/cli, to resolve @rivanna/shared workspace dep.
- 2026-02-18: Next.js 16 `next lint` is broken — use `eslint` directly instead.
- 2026-02-18: smol-toml for TOML parsing (14KB, zero deps, ESM). Zod v4 for validation.
- 2026-02-18: SSHClient uses Bun.spawn, not child_process. ControlMaster for connection reuse.
- 2026-02-18: Vercel redirects rivanna.dev → www.rivanna.dev. Install script uses www. URL.
- 2026-02-18: create-next-app prompts interactively for React Compiler — pipe `echo "n"`.
- 2026-02-18: sinfo GRES includes socket info `gpu:a6000:8(S:0-47)` — regex must match prefix only.
- 2026-02-18: sinfo states include `mixed-`, `inval`, `reserved` — map to mixed/down/allocated.
- 2026-02-18: sshare FairShare is column 7 of 11, NOT last column. Find user row (User column populated).
- 2026-02-18: hdquota output is a table with multi-word types ("Home Directory"), `value unit` size columns.
- 2026-02-18: allocations output is a table (Account/Balance/Reserved/Available), not key-value pairs.
- 2026-02-18: sinfo `--Node` with multiple partitions duplicates rows per partition. Caller should deduplicate.
- 2026-02-18: Allocator pruning must only happen within same GPU type+topology — cross-type pruning destroys fan-out.
- 2026-02-18: GPU count must not be silently capped — skip types that can't fulfill the request entirely.
- 2026-02-18: Rivanna CPU partitions: `standard` (7d, 1 node, 40 CPU, 768GB), `parallel` (3d, 2-64 nodes, 96 CPU). DefMemPerCPU=4000 across all. CPU-only jobs are a separate codepath.
- 2026-02-18: No Ink/React in either project — use ora + chalk + @inquirer/prompts for all CLI UI.
- 2026-02-18: Node memory from sinfo: A100-80 ~1TB, A6000 ~256GB, H200 ~1.5TB. Use for auto `--mem` calculation.
- 2026-02-18: GPUSpec has `nodeMemoryMB` field. Auto-mem = (nodeMemGB × gpuFraction × 1.5), capped at 90% of node.
- 2026-02-18: `theme.warning` not `theme.warn` — the theme object uses `warning`, `success`, `error`, `info`, `muted`, `accent`, `emphasis`.
- 2026-02-18: `allocations` output is a table: `account_name  allocation  used  balance`. Regex: `/^(\S+)\s+(\d+)\s+\d+\s+(\d+)/`.
- 2026-02-18: For safe remote rc file writes, use `sed -i '/marker_start/,/marker_end/d'` + `printf >> file`. Never `cat >`.
- 2026-02-18: SSH key detection should check id_ed25519, id_rsa, id_ecdsa, id_ecdsa_sk, id_ed25519_sk — not just ed25519.
- 2026-02-18: `testKeyAuth()` with BatchMode=yes tests auth without password prompt. Use before `ssh-copy-id` to skip if already authorized.
- 2026-02-18: Slurm batch scripts always source `.bashrc` (bash). Write cache env exports to `.bashrc` regardless of user's login shell.
- 2026-02-18: Notifications use HMAC-SHA256 via `openssl dgst` in bash — available on all Rivanna nodes. No Bearer token needed.
- 2026-02-18: Computing IDs match `/^[a-z]{2,3}\d[a-z]{2,3}$/` (e.g., abs6bd, cm7jk, tqf5qb). Map directly to `@virginia.edu` email.
- 2026-02-18: Template guard for notifications changed from `(notifyUrl && notifyToken)` to just `(notifyUrl)`. notifyToken field kept in types but unused.
- 2026-02-19: MIG QOS strictly limits CPUs — always set `cpusPerTask=1` and cap memory at 16G.
- 2026-02-19: Fast jobs can vanish from `squeue` between polls. Use `sacct` fallback, but account for accounting daemon lag (don't mark FAILED if no sacct record yet).
- 2026-02-19: Smart execution must scan ALL non-flag args for local files, not just `commandArgs[0]`. Supports torchrun/accelerate/deepspeed launchers.
- 2026-02-19: Set `OMP_NUM_THREADS=cpusPerTask` and `TOKENIZERS_PARALLELISM=false` in all templates to prevent CPU oversubscription.
- 2026-02-19: vLLM writes torch compile cache to `~/.cache/vllm/` — set `VLLM_CACHE_DIR` to scratch.
- 2026-02-19: Multi-node torchrun needs `NODE_RANK=$SLURM_PROCID` to discover its rank in static rendezvous.
- 2026-02-19: Checkpoint and direct+timemin strategies serve different purposes — never let one prune the other.
- 2026-02-19: GPU mismatch possible: V100 partition can allocate A6000 nodes. This is a Slurm config issue, not a CLI bug.
- 2026-02-19: Run CLI from source with `bun apps/cli/index.ts` during dev (installed binary may be outdated; `node dist/index.js` fails with "Bun is not defined").
- 2026-02-19: Scratch 90-day purge policy deletes untouched files. Keepalive via `find ... -exec touch -a {} +` on critical dirs, rate-limited to once/day via local timestamp file.
- 2026-02-19: Shared HF cache on `/standard/` or `/project/` detected via `hdquota` + `parseHdquota`. `detectGroupStorage()` returns both dirs and full quota data in one SSH call.
- 2026-02-19: When shared HF cache is active, both `~/.cache/huggingface` AND `/scratch/user/.cache/huggingface` are symlinked to shared path — frameworks that hardcode either path still work.
- 2026-02-19: Checkpoint dir was `$SLURM_JOB_NAME` only — collides on repeated runs. Fixed to `$SLURM_JOB_NAME-$SLURM_JOB_ID` matching log file pattern.
- 2026-02-19: `RV_CHECKPOINT_DIR` is a suggestion, not enforced. Most frameworks (HF Trainer, Lightning, VeRL/FSDP) use their own output_dir config. Document clearly so users configure their framework to use `$RV_CHECKPOINT_DIR`.
- 2026-02-19: Post-job summary (workspace, logs, checkpoints, pull commands) solves discoverability — users know where results are without guessing remote paths.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Reference: ~/all/uvacompute](#2-reference-alluvacompute)
3. [System Context: UVA HPC (Rivanna)](#3-system-context-uva-hpc-rivanna)
4. [Infrastructure & Deployment](#4-infrastructure--deployment)
5. [Key Design Principles](#5-key-design-principles)
6. [Monorepo Structure](#6-monorepo-structure)
7. [Empirical Constants](#7-empirical-constants)
8. [Implementation Phases](#8-implementation-phases)
   - [Phase 1: Monorepo Scaffold](#phase-1-monorepo-scaffold) ✅
   - [Phase 2: Shared Package](#phase-2-shared-package) ✅
   - [Phase 3: CLI Foundation — SSH, Config, Init](#phase-3-cli-foundation--ssh-config-init) ✅
   - [Phase 4: Slurm Parsers & Templates](#phase-4-slurm-parsers--templates) ✅
   - [Phase 5: The Allocator Brain](#phase-5-the-allocator-brain) ✅
   - [Phase 6: Core Commands — up, run, ps, stop](#phase-6-core-commands--up-run-ps-stop) ✅
   - [Phase 7: Supporting Commands](#phase-7-supporting-commands--ssh-logs-status-sync-forward-env-cost) ✅
   - [Phase 7.5: Smart Execution, GPU Verification, Init Hardening](#phase-75-smart-execution-gpu-verification-init-hardening) ✅
   - [Phase 8: Notifications — Resend Email](#phase-8-notifications--resend-email) ✅
   - [Phase 9: Site — Landing, Docs, Install API](#phase-9-site--landing-docs-install-api) ✅
   - [Phase 10: CI/CD & Release Pipeline](#phase-10-cicd--release-pipeline) ✅
   - [Phase 11: Testing & Hardening](#phase-11-testing--hardening) ✅
   - [Phase 12: Storage, Caching & Post-Job UX](#phase-12-storage-caching--post-job-ux) ✅

---

## 1. Project Overview

`rv` is a CLI tool that makes UVA's Rivanna/Afton HPC cluster feel effortless. The user says what they want (GPUs, time, a script to run) and the CLI handles everything: analyzing the queue, submitting optimal requests across GPU types and topologies, monitoring allocation, syncing code, connecting to jobs, forwarding ports, and sending email notifications.

The CLI runs on the user's local machine (macOS/Linux) and communicates with Rivanna over SSH. No dependencies needed on Rivanna itself.

**Two deliverables:**

- `apps/cli` — The `rv` command-line tool (TypeScript, Commander + ora/chalk, compiled to standalone binary via `bun build --compile`)
- `apps/site` — Landing page, docs, install script host, notification webhook API (Next.js on Vercel at `rivanna.dev`)

**Distribution:** Binary via `curl -fsSL https://rivanna.dev/install.sh | bash`. The site's API proxies the latest GitHub Release binary. NOT an npm package.

**Repository:** `charliemeyer2000/rivanna.dev` on GitHub.

---

## 2. Reference: ~/all/uvacompute

**Read these before writing any code:**

- `~/all/uvacompute/apps/cli/` — CLI build system, commander setup, binary compilation. Mirror build/compile/distribute patterns exactly.
- `~/all/uvacompute/apps/cli/index.ts` — Entry point pattern (note: entry is at package root, not `src/`).
- `~/all/uvacompute/apps/cli/package.json` — Dependencies, build scripts.
- `~/all/uvacompute/apps/site/` — Next.js site structure, design, styling, fonts, color palette. Use the same visual design language.
- `~/all/uvacompute/apps/site/public/install.sh` — The curl-based install script pattern.
- `~/all/uvacompute/apps/site/src/app/api/downloads/cli/latest/[platform]/route.ts` — API route that proxies GitHub Release binaries.
- `~/all/uvacompute/.github/workflows/release-cli.yaml` — Manual `workflow_dispatch` release: version bump, cross-platform binary build matrix, GitHub Release creation.
- `~/all/uvacompute/turbo.json` and root `package.json` — Turborepo config, workspace setup.

The `rv` CLI should feel like a sibling product to `uva`. Same quality, same patterns, same install experience.

---

## 3. System Context: UVA HPC (Rivanna)

### Connection

- Hostname: `login.hpc.virginia.edu`
- User: configured during `rv init` (e.g., `abs6bd`)
- Auth: SSH key (ed25519). Key auth is confirmed working. No Duo/MFA on SSH.
- ControlMaster: confirmed working at `~/.ssh/sockets/` — ~400ms per command, parallel commands share the socket.

### GPU Inventory

| GPU         | Partition           | Total     | VRAM   | SU/GPU-hr    | Typical Backfill Wait |
| ----------- | ------------------- | --------- | ------ | ------------ | --------------------- |
| MIG 1g.10gb | gpu-mig             | 56 slices | 10 GB  | **FREE (0)** | **Instant**           |
| RTX 3090    | interactive-rtx3090 | 16        | 24 GB  | 113          | **Instant**           |
| A6000       | gpu-a6000           | 112       | 48 GB  | 143          | ~1 min                |
| A40         | gpu-a40             | 88        | 48 GB  | 187          | ~5 min                |
| H200        | gpu-h200            | 8         | 141 GB | 817          | ~10 min               |
| A100 40GB   | gpu-a100-40         | 16        | 40 GB  | 464          | ~10 min               |
| A100 80GB   | gpu-a100-80         | 128       | 80 GB  | 509          | ~15 min               |
| V100        | gpu-v100            | 8         | 32 GB  | 21           | ~60 min               |

(Wait times are with backfill-eligible walltime. Without backfill: 20-40+ hour waits.)

### Storage

| Location            | Size   | Notes                                 |
| ------------------- | ------ | ------------------------------------- |
| `/home/<user>`      | 200 GB | Persistent, backed up                 |
| `/scratch/<user>`   | 10 TB  | Fast (Weka), **purged after 90 days** |
| `/standard/<group>` | 20 TB  | Shared, persistent                    |
| `/project/<group>`  | varies | Shared, persistent                    |

### User Limits

| Resource                         | Limit                                          |
| -------------------------------- | ---------------------------------------------- |
| Max GPUs running (gpu partition) | 32 per user                                    |
| Max H200 GPUs                    | 4 per user                                     |
| Max interactive GPUs             | 2 per user                                     |
| Max MIG slices                   | 28 per user                                    |
| Max walltime (gpu)               | 3 days                                         |
| Max walltime (interactive)       | 12 hours                                       |
| Max concurrent submissions       | 10,000                                         |
| Default walltime                 | 5 hours (**avoid — above backfill threshold**) |

### Key Scheduler Findings

Discovered empirically by running experiments on the cluster:

1. **Backfill cliff**: Jobs requesting <=~3hr walltime get backfilled (seconds to minutes). Jobs >=4hr wait for priority turn (hours to days). Exact threshold varies with queue state.
2. **Cross-type fan-out works**: Submitting to A6000 + A40 + A100 + RTX3090 simultaneously, first to allocate wins. RTX3090 in <1min, A6000 in ~2min, A100-80 in ~20hr.
3. **Node targeting hurts**: `--nodelist` causes PENDING (PLANNED state). Let the scheduler decide.
4. **Multi-node faster than single-node for 8 GPUs**: 2x4 A6000 ~3.5hr wait vs 1x8 A6000 ~12hr wait.
5. **MIG is free**: 0 SUs, instant allocation, always available.
6. **35+ concurrent submissions no problem**: Limit is 10,000. No penalty for mass submissions.
7. **Compute nodes have full internet**: github, pypi, huggingface all reachable.
8. **`srun --overlap --pty bash` works** for connecting to running jobs without SSH keys on compute nodes (used by `rv ssh`).
9. **`sbatch --test-only`** returns estimated start time without submitting. Can be used for binary search on backfill window.

### Software on Rivanna

- `uv` (0.9.7) at `~/.local/bin/uv` — already installed
- `pnpm` (10.25.0) — already installed
- Python system: 3.6.8 (**too old, use module**)
- `module load miniforge/24.11.3-py3.12` -> Python 3.12.9
- `module load cuda/12.8.0` -> CUDA 12.8
- No Node.js, no Bun on Rivanna
- No sudo, no Docker — use Apptainer for containers
- `rsync` available

---

## 4. Infrastructure & Deployment

### Environments

| Environment | Domain           | Purpose                               |
| ----------- | ---------------- | ------------------------------------- |
| Development | `localhost:3000` | Local dev with `bun dev` / `next dev` |
| Production  | `rivanna.dev`    | Live site on Vercel                   |

### Vercel Setup

- Domain `rivanna.dev` is already connected to Vercel
- GitHub repo `charliemeyer2000/rivanna.dev` is connected for auto-deployments on push to `main`
- Use `vercel.json` with `{ "ignoreCommand": "npx turbo-ignore" }` (same as uvacompute)
- Site lives in `apps/site/` — Vercel should be configured with root directory `apps/site`

### Environment Variable Management

Use the Vercel CLI (`vc`) to manage environment variables across dev and production:

```bash
# Add a variable for all environments
vc env add RESEND_API_KEY

# Add for specific environment
vc env add GITHUB_TOKEN production
vc env add GITHUB_TOKEN development

# Pull env vars for local development
vc env pull .env.local

# List all env vars
vc env ls
```

Required environment variables:

| Variable             | Environments            | Purpose                                          |
| -------------------- | ----------------------- | ------------------------------------------------ |
| `RESEND_API_KEY`     | production, development | Send email notifications via Resend              |
| `GITHUB_TOKEN`       | production              | Proxy GitHub Release binaries for install script |
| `NOTIFY_HMAC_SECRET` | production, development | HMAC verification of notification requests       |

### CI/CD

**Site deployment:** Automatic via Vercel on push to `main`. No GitHub Action needed.

**CLI releases:** Manual `workflow_dispatch` GitHub Action (mirror `~/all/uvacompute/.github/workflows/release-cli.yaml`):

1. Triggered manually with version bump type (patch/minor/major) or custom version
2. Bumps version in `apps/cli/package.json`
3. Commits, tags `cli-v<version>`, pushes tag
4. Build matrix: `ubuntu-latest` (linux-x64), `macos-latest` (darwin-arm64/x64)
5. `bun build --compile` produces standalone binary
6. Creates GitHub Release with binary artifacts
7. Install script + site API route serve the latest release binary

### Binary Distribution Flow

```
User runs: curl -fsSL https://rivanna.dev/install.sh | bash
  -> install.sh calls: https://rivanna.dev/api/downloads/cli/latest/<platform>
    -> API route fetches latest GitHub Release from charliemeyer2000/rivanna.dev
      -> Streams binary back to user
        -> Installed to ~/.local/bin/rv
```

---

## 5. Key Design Principles

1. **The user never thinks about Slurm.** They say what they want; the CLI handles scheduling, partitions, walltimes, fan-out, checkpoint-restart. All of it invisible.
2. **Always aggressive allocation.** Every `rv up` automatically analyzes the queue and submits the optimal set of strategies. No `--fast` flag. It's always fast.
3. **Backfill is king.** Default walltime should be computed dynamically, not hardcoded. The allocator probes the queue with `sbatch --test-only` to find the exact backfill window before every submission.
4. **Cross-type fan-out, not node targeting.** Submit to multiple GPU types simultaneously. Never use `--nodelist`. The scheduler is smarter than us at node selection.
5. **Short walltimes + checkpoint-restart > long walltimes.** A 24-hour job that runs as 8x3hr segments starts immediately. A single 24hr submission waits 2 days.
6. **MIG for everything lightweight.** Package installs, data preprocessing, small inference — MIG is free and instant. The CLI should suggest it when appropriate.
7. **`--json` on every command.** Humans get Ink TUI. AI agents get structured JSON. Same data, different presentation.
8. **One SSH connection.** ControlMaster means the first command opens the connection, everything after reuses it. Batch queries into single SSH calls where possible.
9. **Don't reinvent what Slurm does well.** The CLI generates Slurm scripts and calls `sbatch`. It doesn't try to build its own scheduler. It just plays the existing game optimally.
10. **Mirror uvacompute patterns.** Same CLI feel (`rv up` ~ `uva vm create`), same install experience, same site design, same monorepo structure.

---

## 6. Monorepo Structure

Use Turborepo with bun workspaces. Mirror `~/all/uvacompute`.

```
rivanna.dev/
├── turbo.json
├── package.json                     # bun workspace root
├── biome.json
├── PLAN.md                          # this file
├── apps/
│   ├── cli/
│   │   ├── package.json             # name: "rivanna-cli"
│   │   ├── tsconfig.json
│   │   ├── index.ts                 # commander program entry (mirrors uvacompute)
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── init.ts
│   │   │   │   ├── up.ts            # THE core command
│   │   │   │   ├── run.ts
│   │   │   │   ├── ps.ts
│   │   │   │   ├── stop.ts
│   │   │   │   ├── ssh-cmd.ts
│   │   │   │   ├── ssh.ts
│   │   │   │   ├── logs.ts
│   │   │   │   ├── status.ts
│   │   │   │   ├── sync.ts
│   │   │   │   ├── forward.ts
│   │   │   │   ├── env.ts
│   │   │   │   ├── cost.ts
│   │   │   │   ├── exec.ts          # run commands on login node (no GPU)
│   │   │   │   └── notify.ts
│   │   │   ├── core/
│   │   │   │   ├── ssh.ts           # SSH connection manager (ControlMaster)
│   │   │   │   ├── slurm.ts         # sbatch/squeue/sinfo/sacct wrappers
│   │   │   │   ├── allocator.ts     # THE ALLOCATOR BRAIN
│   │   │   │   ├── config.ts        # ~/.rv/config.toml reader/writer
│   │   │   │   ├── project.ts       # smart execution: detect file, sync, deps, rewrite
│   │   │   │   ├── env-store.ts     # env var storage (~/.rv/env.json)
│   │   │   │   ├── forward-store.ts # port forward tracking (~/.rv/forwards.json)
│   │   │   │   ├── job-naming.ts    # AI + heuristic job naming
│   │   │   │   └── log-tailer.ts    # real-time log streaming for batch jobs
│   │   │   ├── parsers/
│   │   │   │   ├── sinfo.ts         # parse sinfo node/GPU state
│   │   │   │   ├── squeue.ts        # parse squeue job listings
│   │   │   │   ├── sshare.ts        # parse fairshare score
│   │   │   │   ├── sacct.ts         # parse job accounting
│   │   │   │   ├── hdquota.ts       # parse storage quotas
│   │   │   │   └── allocations.ts   # parse SU balance
│   │   │   ├── templates/
│   │   │   │   ├── base.ts          # common Slurm preamble
│   │   │   │   ├── simple.ts        # single-node job
│   │   │   │   ├── multi-node.ts    # multi-node distributed
│   │   │   │   ├── ray.ts           # Ray cluster setup
│   │   │   │   └── checkpoint.ts    # checkpoint-restart wrapper
│   │   │   └── lib/
│   │   │       ├── constants.ts     # SSH paths, format strings, defaults
│   │   │       ├── errors.ts        # typed error classes (VPNError, etc.)
│   │   │       ├── setup.ts         # ensureSetup(), parseTime()
│   │   │       └── theme.ts         # chalk theme (success, warning, error, etc.)
│   │   └── dist/                    # compiled binaries (gitignored)
│   │
│   └── site/                        # Next.js on Vercel
│       ├── package.json
│       ├── next.config.ts
│       ├── vercel.json              # { "ignoreCommand": "npx turbo-ignore" }
│       ├── app/
│       │   ├── page.tsx             # landing page
│       │   ├── layout.tsx
│       │   ├── docs/                # documentation pages
│       │   ├── install/
│       │   │   └── route.ts         # serves install.sh script
│       │   └── api/
│       │       ├── notify/
│       │       │   └── route.ts     # webhook receiver -> Resend email
│       │       └── downloads/
│       │           └── cli/
│       │               └── latest/
│       │                   └── [platform]/
│       │                       └── route.ts  # proxy GitHub Release binaries
│       ├── components/
│       └── public/
│           └── install.sh           # curl install script
│
├── packages/
│   └── shared/                      # shared types + constants
│       ├── package.json
│       └── src/
│           ├── types.ts             # Job, GPU, Storage, Config types
│           ├── gpu-specs.ts         # GPU inventory, VRAM, SU rates
│           └── constants.ts         # partition names, limits, etc.
│
└── .github/
    └── workflows/
        └── release-cli.yml          # manual workflow_dispatch: build + release
```

---

## 7. Empirical Constants

These go in `packages/shared/src/gpu-specs.ts` and `packages/shared/src/constants.ts`.

```typescript
export const GPU_SPECS = {
  mig: {
    partition: "gpu-mig",
    gres: "gpu:1g.10gb",
    vramGB: 10,
    suPerGPUHour: 0,
    maxPerUser: 28,
    maxPerJob: 1,
    maxWalltime: "3-00:00:00",
    perNode: 56,
  },
  rtx3090: {
    partition: "interactive-rtx3090",
    gres: "gpu:rtx3090",
    vramGB: 24,
    suPerGPUHour: 113.23,
    maxPerUser: 2,
    maxPerJob: 2,
    maxWalltime: "12:00:00",
    perNode: 4,
  },
  a6000: {
    partition: "gpu-a6000",
    gres: "gpu:a6000",
    vramGB: 48,
    suPerGPUHour: 142.73,
    maxPerUser: 32,
    maxPerJob: 8,
    maxWalltime: "3-00:00:00",
    perNode: 8,
  },
  a40: {
    partition: "gpu-a40",
    gres: "gpu:a40",
    vramGB: 48,
    suPerGPUHour: 186.69,
    maxPerUser: 32,
    maxPerJob: 8,
    maxWalltime: "3-00:00:00",
    perNode: 8,
  },
  a100_40: {
    partition: "gpu-a100-40",
    gres: "gpu:a100",
    vramGB: 40,
    suPerGPUHour: 463.81,
    maxPerUser: 32,
    maxPerJob: 8,
    maxWalltime: "3-00:00:00",
    perNode: 8,
  },
  a100_80: {
    partition: "gpu-a100-80",
    gres: "gpu:a100",
    vramGB: 80,
    suPerGPUHour: 508.89,
    maxPerUser: 32,
    maxPerJob: 8,
    maxWalltime: "3-00:00:00",
    perNode: 8,
    features: ["gpupod", "a100_80gb"],
    hasInfiniBand: true,
    hasNVLink: true,
  },
  v100: {
    partition: "gpu-v100",
    gres: "gpu:v100",
    vramGB: 32,
    suPerGPUHour: 20.96,
    maxPerUser: 32,
    maxPerJob: 4,
    maxWalltime: "3-00:00:00",
    perNode: 4,
  },
  h200: {
    partition: "gpu-h200",
    gres: "gpu:h200",
    vramGB: 141,
    suPerGPUHour: 816.67,
    maxPerUser: 4,
    maxPerJob: 4,
    maxWalltime: "3-00:00:00",
    perNode: 8,
  },
} as const;

export const SCHEDULER_CONFIG = {
  backfillResolutionSeconds: 600,
  schedMinIntervalSeconds: 2,
  priorityDecayHalfLifeDays: 7,
  priorityMaxAgeDays: 28,
  preemptMode: "OFF",
  defaultWalltime: "5:00:00", // AVOID — above typical backfill threshold
  recommendedWalltime: "2:59:00", // just under typical backfill threshold
  maxSubmissions: 10000,
} as const;

export const PATHS = {
  rvDir: (user: string) => `/scratch/${user}/.rv`,
  logs: (user: string) => `/scratch/${user}/.rv/logs`,
  envFiles: (user: string) => `/scratch/${user}/.rv/env`,
  workspaces: (user: string) => `/scratch/${user}/rv-workspaces`,
  cache: {
    uv: (user: string) => `/scratch/${user}/.cache/uv`,
    pip: (user: string) => `/scratch/${user}/.cache/pip`,
    hf: (user: string) => `/scratch/${user}/.cache/huggingface`,
  },
} as const;
```

---

## 8. Implementation Phases

Each phase below is designed to be one Claude Code plan-mode session. They are ordered by dependency — earlier phases must be completed before later ones can start.

---

### Phase 1: Monorepo Scaffold ✅

**Goal:** Empty but fully functional monorepo with all tooling configured. Every package can be built and the site can `dev`.

**Steps:**

1. Initialize root `package.json` with bun workspaces pointing to `apps/*` and `packages/*`
2. Create `turbo.json` (mirror `~/all/uvacompute/turbo.json`)
3. Create `biome.json` (mirror uvacompute)
4. Create `apps/cli/package.json` with name `rivanna-cli`, dependencies: `commander`, `ink`, `react`, `chalk`, `ora`, `@inquirer/prompts`, `zod`, `toml` (check uvacompute for exact deps)
5. Create `apps/cli/tsconfig.json` (ESNext, bundler resolution, strict)
6. Create `apps/cli/index.ts` — minimal commander program that prints version
7. Create `apps/site/` — scaffold Next.js app with `bun create next-app` or manually. Configure App Router, Tailwind CSS v4, TypeScript.
8. Create `apps/site/vercel.json` with `{ "ignoreCommand": "npx turbo-ignore" }`
9. Create `packages/shared/package.json` and `packages/shared/tsconfig.json`
10. Verify: `bun install` at root works, `bun run build` in each package works, `bun dev` in site works

**Reference:** `~/all/uvacompute/package.json`, `~/all/uvacompute/turbo.json`

---

### Phase 2: Shared Package ✅

**Goal:** `packages/shared` with all types, GPU specs, and constants that both CLI and site will import.

**Steps:**

1. Create `packages/shared/src/types.ts` — TypeScript types for:
   - `GPUSpec` (partition, gres, vramGB, suPerGPUHour, limits)
   - `Job` (id, name, gpus, node, status, time)
   - `Strategy` (partition, gres, time, backfill, checkpointRestart, nodes)
   - `UserRequest` (gpuCount, gpuType, time, run command, etc.)
   - `SystemState` (nodes, queues, backfillWindows, fairshare)
   - `Config` (connection, defaults, paths, notifications)
   - `NotificationEvent` (user, jobId, jobName, event, node, timestamp)
2. Create `packages/shared/src/gpu-specs.ts` — the `GPU_SPECS` constant from Section 7
3. Create `packages/shared/src/constants.ts` — `SCHEDULER_CONFIG`, `PATHS`, partition names
4. Create `packages/shared/src/index.ts` — barrel export
5. Verify: both `apps/cli` and `apps/site` can import from `@rivanna/shared` (or whatever the workspace package name is)

---

### Phase 3: CLI Foundation — SSH, Config, Init ✅

**Goal:** The SSH layer, config system, and `rv init` command working end-to-end.

**Spec — SSH Layer (`src/core/ssh.ts`):**

The SSH layer wraps `child_process.spawn('ssh', ...)` using the user's SSH config. It does NOT use a Node SSH library — it relies on OpenSSH's ControlMaster.

```typescript
interface SSHClient {
  exec(command: string): Promise<string>;
  execBatch(commands: string[], delimiter?: string): Promise<string[]>;
  writeFile(remotePath: string, content: string): Promise<void>;
  rsync(
    localPath: string,
    remotePath: string,
    options?: RsyncOptions,
  ): Promise<void>;
  tunnel(
    localPort: number,
    remoteHost: string,
    remotePort: number,
  ): Promise<ChildProcess>;
  isConnected(): Promise<boolean>;
}
```

Batched execution (turns 6 SSH round trips into 1):

```typescript
async execBatch(commands: string[]): Promise<string[]> {
  const delimiter = '___RV_DELIM___';
  const combined = commands.join(` && echo "${delimiter}" && `);
  const output = await this.exec(combined);
  return output.split(delimiter).map(s => s.trim());
}
```

VPN/connectivity check before any SSH command.

**Spec — Config (`src/core/config.ts`):**

Read/write `~/.rv/config.toml`. Use a TOML library. Config shape:

```toml
[connection]
host = "rv-hpc"
user = "abs6bd"

[defaults]
account = "meng-lab"
gpu_type = "any"
time = "2:59:00"
partition = "gpu"

[paths]
scratch = "/scratch/abs6bd"
home = "/home/abs6bd"

[notifications]
enabled = false
email = ""
```

**Spec — `rv init` command:**

Interactive first-time setup:

1. Ask for UVA computing ID (e.g., `abs6bd`)
2. Ask for SSH host alias or hostname (default: `login.hpc.virginia.edu`)
3. Check if SSH key exists (`~/.ssh/id_ed25519`). If not, generate one.
4. Copy key to Rivanna via `ssh-copy-id` (user types password this one time)
5. Test key auth: `ssh <host> "echo ok"`
6. Add/update SSH config with ControlMaster:
   ```
   Host rv-hpc
       HostName login.hpc.virginia.edu
       User <computing_id>
       ControlMaster auto
       ControlPath ~/.ssh/sockets/rv-hpc-%r@%h-%p
       ControlPersist 30m
       ServerAliveInterval 60
       IdentityFile ~/.ssh/id_ed25519
   ```
7. Create `~/.ssh/sockets/` directory if needed
8. SSH in and discover: run `allocations` to find default account, `hdquota` for storage
9. Write `~/.rv/config.toml`
10. Redirect caches to scratch (home is only 200GB):
    ```bash
    mkdir -p /scratch/<user>/.cache/{uv,pip,huggingface}
    ```
    Add to `~/.bashrc` on Rivanna:
    ```bash
    export UV_CACHE_DIR=/scratch/<user>/.cache/uv
    export PIP_CACHE_DIR=/scratch/<user>/.cache/pip
    export HF_HOME=/scratch/<user>/.cache/huggingface
    ```

**Reference:** `~/all/uvacompute/apps/cli/` for commander patterns, `@inquirer/prompts` for interactive prompts.

---

### Phase 4: Slurm Parsers & Templates ✅

**Goal:** All Slurm output parsers and job script template generators.

**Parsers (`src/parsers/`):**

Each parser takes raw stdout from a Slurm command and returns typed data.

- `sinfo.ts` — parse `sinfo -p gpu -N -o "%N %t %G %C"` into node/GPU availability
- `squeue.ts` — parse `squeue` output into job listings (running, pending, completed)
- `sshare.ts` — parse `sshare` into fairshare score
- `sacct.ts` — parse `sacct` into job accounting history
- `hdquota.ts` — parse `hdquota` output into storage usage per mount
- `allocations.ts` — parse `allocations` output into SU balance per account

**Slurm wrappers (`src/core/slurm.ts`):**

Thin wrappers that call SSH + parser:

```typescript
async getNodeState(): Promise<NodeState[]>;
async getJobs(user: string): Promise<Job[]>;
async getFairshare(): Promise<number>;
async getStorageQuota(): Promise<StorageQuota[]>;
async getSUBalance(): Promise<SUBalance>;
async submitJob(script: string): Promise<string>; // returns job ID
async cancelJob(jobId: string): Promise<void>;
async testOnly(options: SbatchOptions): Promise<TestOnlyResult>;
```

**Templates (`src/templates/`):**

Generate Slurm bash scripts from typed options:

- `base.ts` — common preamble (module loads, env sourcing, notification hooks)
- `simple.ts` — single-node job
- `multi-node.ts` — multi-node distributed (MPI/NCCL setup)
- `ray.ts` — Ray cluster (head + worker nodes)
- `checkpoint.ts` — checkpoint-restart wrapper (timeout + resubmit)

Checkpoint-restart template:

```bash
#!/bin/bash
#SBATCH -p <partition>
#SBATCH --gres=<gres>
#SBATCH -t <backfill_ceiling>
#SBATCH -A <account>
#SBATCH -J <name>
#SBATCH -o /scratch/<user>/.rv/logs/%x-%j.out
#SBATCH -e /scratch/<user>/.rv/logs/%x-%j.err

module load cuda/12.8.0 miniforge/24.11.3-py3.12
source /scratch/<user>/.rv/env/$SLURM_JOB_ID.env 2>/dev/null && rm -f /scratch/<user>/.rv/env/$SLURM_JOB_ID.env

_rv_notify() { curl -sf -X POST "$RV_NOTIFY_URL" -H "Authorization: Bearer $RV_NOTIFY_TOKEN" -H "Content-Type: application/json" -d "{\"user\":\"$USER\",\"jobId\":\"$SLURM_JOB_ID\",\"jobName\":\"$SLURM_JOB_NAME\",\"event\":\"$1\",\"node\":\"$(hostname)\",\"timestamp\":\"$(date -Iseconds)\"}" 2>/dev/null & }
trap '_rv_notify FAILED' ERR
_rv_notify STARTED

RV_SEGMENT_START=$(date +%s)
RV_TOTAL_ELAPSED=${RV_TOTAL_ELAPSED:-0}
RV_TOTAL_REQUESTED=<total_seconds>

BUFFER_SECONDS=600
WALLTIME_SECONDS=<walltime_in_seconds>
TIMEOUT=$((WALLTIME_SECONDS - BUFFER_SECONDS))

timeout --signal=SIGUSR1 ${TIMEOUT}s <user_command>
EXIT_CODE=$?

SEGMENT_ELAPSED=$(( $(date +%s) - RV_SEGMENT_START ))
NEW_TOTAL=$(( RV_TOTAL_ELAPSED + SEGMENT_ELAPSED ))

if [ $EXIT_CODE -ne 0 ] && [ $NEW_TOTAL -lt $RV_TOTAL_REQUESTED ]; then
  export RV_TOTAL_ELAPSED=$NEW_TOTAL
  sbatch --export=ALL,RV_TOTAL_ELAPSED=$NEW_TOTAL $0
  _rv_notify RESUBMITTED
else
  _rv_notify COMPLETED
fi
```

---

### Phase 5: The Allocator Brain ✅

**Goal:** The most important code in the project. `src/core/allocator.ts`.

Given a user request like "4 GPUs, A100, 24 hours", the allocator:

**Step 1 — Query live system state** (one batched SSH call, ~400ms):

- `sinfo` -> which nodes are idle/mixed/allocated, what GPUs are free
- `squeue -t RUNNING` -> what's running, remaining walltimes (for backfill window estimation)
- `squeue -t PENDING` -> what's pending (for queue depth)
- `sshare` -> user's fairshare score

**Step 2 — Compute backfill window** per GPU type:

Uses `sbatch --test-only` with binary search on walltime to find the exact backfill cliff for each eligible GPU type. Example: binary search between 30min and 6hr for A6000 -> finds cliff at 2hr47min.

Batch all probes into one SSH call:

```bash
for T in 0:30:00 1:00:00 2:00:00 3:00:00 4:00:00 6:00:00; do
  echo "TEST:$T"
  sbatch --test-only --wrap="sleep 1" -p gpu-a6000 --gres=gpu:a6000:4 -t $T -A meng-lab 2>&1
done
```

**Step 3 — Generate strategies:**

Each strategy is a valid way to fulfill the request:

- Exact match: requested GPU type and count
- Alternative GPU types: if user said "a100", also try a6000 (48GB) if VRAM fits
- Different topologies: 1x8 vs 2x4 vs 4x2 (multi-node is often faster)
- Time variants: full walltime vs backfill-eligible walltime with checkpoint-restart
- MIG (if 1 GPU and <=10GB VRAM needed)
- Interactive partition (if <=2 GPUs and <=12hr)

```typescript
function generateStrategies(
  request: UserRequest,
  state: SystemState,
): Strategy[] {
  const strategies: Strategy[] = [];
  const backfillWindows = state.backfillWindows;

  const compatible = getCompatibleGPUs(request);

  for (const gpu of compatible) {
    const backfillCeiling = backfillWindows[gpu.partition];

    if (backfillCeiling && request.timeSeconds <= backfillCeiling) {
      strategies.push({
        partition: gpu.partition,
        gres: gpu.gres,
        time: request.time,
        backfill: true,
      });
    } else if (backfillCeiling) {
      strategies.push({
        partition: gpu.partition,
        gres: gpu.gres,
        time: backfillCeiling,
        checkpointRestart: true,
      });
    }

    if (request.gpuCount >= 4 && request.gpuCount <= gpu.perNode) {
      strategies.push({ ...same, nodes: 2, gpusPerNode: request.gpuCount / 2 });
    }
  }

  if (request.gpuCount === 1 && (request.vramMin ?? 80) <= 10) {
    strategies.push({
      partition: "gpu-mig",
      gres: "gpu:1g.10gb:1",
      free: true,
    });
  }

  if (request.gpuCount <= 2 && request.timeSeconds <= 12 * 3600) {
    strategies.push({
      partition: "interactive-rtx3090",
      gres: `gpu:rtx3090:${request.gpuCount}`,
    });
  }

  return rankAndPrune(strategies);
}
```

**Step 4 — Prune and rank:**

- Remove dominated strategies (worse in every dimension)
- Score by: P(instant backfill) > estimated wait time > quality of fit > SU cost
- Cap at ~6-8 strategies

**Step 5 — Submit all simultaneously** via `sbatch`

**Step 6 — Monitor** (poll `squeue` every 5-10 seconds):

- First strategy to reach RUNNING state wins
- Cancel all other submissions immediately
- Return winning job's ID, node, GPU type

---

### Phase 6: Core Commands — up, run, ps, stop ✅

**Goal:** The core commands working end-to-end. `rv up` is interactive-only; `rv run` is batch-only.

**`rv up [options]` — interactive GPU allocation:**

```
rv up                                  # interactive GPU shell (1 GPU, allocator picks type)
rv up --gpu 4                          # 4 GPUs, allocator picks fastest type
rv up --gpu 4 --type a100              # 4 A100s specifically
rv up --gpu 8 --time 24h              # 8 GPUs for 24 hours (auto checkpoint-restart)
rv up --mig                            # free MIG slice (instant, for setup tasks)
```

Options:

```
--gpu <N>              Number of GPUs (default: 1)
--type <type>          GPU type: a100, a6000, a40, h200, v100, rtx3090, mig (default: "any")
--time <duration>      Total time needed: 2h, 24h, 3d (allocator handles segmenting)
--mem <amount>         Memory: 64G, 256G, 1T
--mig                  Shortcut for --gpu 1 --type mig (free, instant)
--name <name>          Job name
--dry-run              Show what would be submitted, don't submit
--json                 Output result as JSON
```

Behavior:

1. Run the allocator -> queries queue, computes backfill windows, generates strategy set
2. Show brief status: "Submitting 4 strategies across A6000, A40, A100..."
3. Submit all strategies simultaneously via `sbatch`
4. Monitor showing each strategy's status, queue position, ETA
5. When first strategy starts RUNNING: cancel all others, announce winner
6. Attach to the job interactively via `srun --overlap --pty bash`

If `--time` exceeds backfill window: the allocator segments into backfill-eligible chunks using checkpoint-restart template.

**`rv run <command> [options]` — batch execution:**

Allocates GPUs, syncs local files, runs the command, streams output until completion.

```
rv run python train.py
rv run "huggingface-cli download meta-llama/Llama-3.1-8B" --time 2h
rv run "python preprocess.py" --gpu 1 --type mig
```

**`rv ps [options]`:**

```
rv ps                    # active jobs (running + pending)
rv ps --all              # include completed/failed
rv ps --json             # structured output
```

Output:

```
ID        Name          GPUs      Node           Status   Time      Left
9531337   train-grpo    4xA6000   udc-an38-9     RUNNING  1:23:00   1:36:00
9531342   download-llm  1xMIG     udc-an34-1     RUNNING  0:05:00   2:54:00
9531350   eval-sweep    2xA100    (pending)       PENDING  -         est. 45m
```

**`rv stop [job_id | --all]`:**

```
rv stop 9531337          # cancel specific job
rv stop --all            # cancel all your jobs
```

---

### Phase 7: Supporting Commands — ssh, logs, status, sync, forward, env, cost ✅

**Goal:** All remaining CLI commands. `rv attach` was merged into `rv ssh`.

**`rv ssh [job_id]`:**

Attach to a running job's compute node. Uses `srun --jobid=<JOB> --overlap --pty /bin/bash`.

```
rv ssh                   # attach to most recent running job
rv ssh 9531337           # attach to specific job
rv ssh --config          # print SSH config entry for VS Code / Cursor
```

For `--config`, output:

```
Host rv-compute
    HostName udc-an38-9
    ProxyJump rv-hpc
    User abs6bd
```

Note: SSH to compute nodes should work since `/home` is NFS-shared and `rv init` sets up authorized_keys. If direct SSH fails, fall back to `srun --overlap`.

**`rv logs [job_id] [options]`:**

```
rv logs                  # tail stdout of most recent job
rv logs 9531337          # specific job
rv logs --err            # tail stderr
rv logs --pull           # download log files to local machine
rv logs --search "CUDA"  # grep across logs
```

rv-generated jobs put logs in `/scratch/<user>/.rv/logs/<jobname>-<jobid>.{out,err}`.

**`rv status [options]`:**

Dashboard showing everything at a glance (using Ink):

```
Connection: OK (rv-hpc)
Account: meng-lab | SUs: 8,742,210 remaining

Storage
Home     /home/abs6bd              100/200 GB  50%
Scratch  /scratch/abs6bd             0/10 TB   0%

Active Jobs
9531337  train-grpo  4xA6000  udc-an38-9  RUNNING  1:23/3:00

GPU Availability
MIG      56 slices  36%  FREE    instant
RTX3090  16 GPUs    63%  113 SU  instant
A6000    112 GPUs   91%  143 SU  ~1 min
...
```

Data sources (all batched into one SSH call): `allocations`, `hdquota`, `squeue -u <user>`, `sinfo`, `squeue -p gpu -t RUNNING`.

**`rv sync <push|pull|watch>`:**

```
rv sync push                          # push CWD -> /scratch/<user>/<dirname>
rv sync push . /scratch/abs6bd/myproj # push to specific remote path
rv sync pull /scratch/abs6bd/results ./results
rv sync watch                         # continuous push on file changes
```

Uses `rsync` over SSH. Respects `.gitignore` (via `--filter=':- .gitignore'`). Also respects `.rvignore` for additional exclusions.

Default auto-exclude patterns: `*.bin`, `*.safetensors`, `*.gguf`, `*.pt`, `*.pth`, `__pycache__/`, `node_modules/`, `.git/`

**`rv forward <port> [job_id]`:**

```
rv forward 8265                       # forward port from most recent job
rv forward 8265 9531337               # from specific job
rv forward 8265 8888                  # multiple ports
rv forward --auto                     # auto-detect Ray, Jupyter, TensorBoard, vLLM, Gradio
```

Implementation: `ssh -L <port>:<compute_node>:<port> rv-hpc -N`

Auto-detect ports: Ray (8265), Jupyter (8888), TensorBoard (6006), vLLM (8000), Gradio (7860).

**`rv env <subcommand>`:**

```
rv env set WANDB_API_KEY wk-abc123   # store a secret
rv env set NCCL_DEBUG INFO           # store a non-secret
rv env list                          # show all (secrets masked)
rv env rm WANDB_API_KEY              # remove
```

Secrets stored encrypted in `~/.rv/secrets.json` (Node.js `crypto`, key from SSH key fingerprint).

At job submission:

1. Write all env vars to `/scratch/<user>/.rv/env/<jobid>.env` via SSH
2. Slurm script sources it then deletes it
3. `srun --export=ALL` propagates to all nodes

**`rv cost [options]`:**

```
rv cost --gpu 4 --type a100 --time 24h
```

Output:

```
Estimated cost: 4 x A100-80 x 24h = 48,854 SUs
Balance after: 8,691,798 / 8,742,210 SUs (99.4%)
```

---

### Phase 7.5: Smart Execution, GPU Verification, Init Hardening ✅

**Goal:** Post-stress-test improvements discovered during real-world vLLM/multi-GPU testing.

**Completed work:**

1. **Smart execution** (`core/project.ts`): `rv run train.py` detects local file, rsyncs project, discovers deps, creates remote venv via uv, rewrites command. `rv exec` command for login-node-only tasks.
2. **GPU verification** (`allocator.ts`): After allocation, queries actual GPU hardware on the node via `sinfo -n <node>`. Reports mismatches (e.g., requested A100 but got scheduled on wrong node).
3. **Auto-memory** (`allocator.ts`, `base.ts`): Calculates `--mem` from proportional node memory share (1.5x proportional, capped at 90% of node). Prevents OOM kills. Overridable with `--mem`.
4. **Topology warnings** (`allocator.ts`): Warns about multi-node NCCL over network, missing InfiniBand, missing NVLink.
5. **AI job naming** (`core/job-naming.ts`): Optional AI-generated job names via Anthropic/OpenAI API.
6. **Log tailing** (`core/log-tailer.ts`): Real-time log streaming for batch jobs.
7. **Checkpoint env vars** (`base.ts`): `RV_CHECKPOINT_DIR` and `CHECKPOINT_DIR` set automatically.
8. **`--time-min`** for backfill: Strategies set `--time-min` to backfill ceiling so Slurm can schedule into variable-length gaps.
9. **Resumable init** (`init.ts`): Config saved early for resumability. Detects existing SSH keys (ed25519/rsa/ecdsa), tests auth before ssh-copy-id, retries 3x. VPN check before any SSH.
10. **Shell detection** (`init.ts`): Detects remote shell (bash/zsh/fish), writes cache env vars to correct rc file. Always writes `.bashrc` for Slurm compatibility.
11. **VPN status in `rv status`** (`status.ts`): Graceful handling of SSH failures — shows "DISCONNECTED" or "AUTH FAILED" instead of crashing.

---

### Phase 8: Notifications — Resend Email ✅

**Goal:** Email notifications for job events via Resend. No signup required.

**Architecture:**

```
Slurm job (compute node) --curl (HMAC-signed)--> rivanna.dev/api/notify (Vercel) --Resend--> user@virginia.edu
```

**Completed work:**

1. **HMAC-signed notification hook** (`templates/base.ts`): Slurm scripts compute `HMAC-SHA256(secret, "user:jobId:event:epoch")` via `openssl dgst` and include the signature in the POST. No Bearer token needed.
2. **`/api/notify` route** (`apps/site/src/app/api/notify/route.ts`): Verifies HMAC signature, validates computing ID format (`/^[a-z]{2,3}\d[a-z]{2,3}$/`), enforces 10-minute timestamp window (anti-replay), rate limits 20 emails/user/hour, sends HTML email via Resend to `{computingId}@virginia.edu`.
3. **Fixed notification bugs**: `up.ts` had `notifyUrl: config.notifications.enabled ? undefined : undefined` (always undefined). `run.ts` was missing `notifyUrl` entirely. Both now use `NOTIFY_URL` constant.
4. **Notifications enabled by default** (`init.ts`): New users get `notifications.enabled = true`, `email = "{user}@virginia.edu"`. Existing users unaffected until `rv init --force`.
5. **Email events**: STARTED (blue), COMPLETED (green), FAILED (red), RESUBMITTED (amber). Clean HTML emails with job ID, node, timestamp.
6. **No signup required**: Email derived from computing ID. No user database, no registration endpoint. Shared HMAC secret prevents unauthenticated access.
7. **From address**: `rv <noreply@rivanna.dev>` via Resend (domain verification required).

---

### Phase 9: Site — Landing, Docs, Install API ✅

**Goal:** The Next.js site at `rivanna.dev`.

**Completed work:**

1. **Simplified landing page** (`src/app/page.tsx`): Removed AI-slop content, fixed incorrect `rv submit` → `rv run`. Now: title + tagline + install command + 3-command quickstart + docs link + footer.

2. **Full docs site** with 4 pages (matching uvacompute design patterns — motion animations, sidebar nav, CodeBlock component):
   - `/docs` — Getting Started: install, setup (`rv init`), first job (MIG, batch, status)
   - `/docs/commands` — All 14 commands with options tables, usage examples, subcommand docs
   - `/docs/allocator` — How it works (5-step), fan-out strategy, backfill detection, checkpoint-restart, full GPU specs table
   - `/docs/configuration` — Config file reference, defaults, notifications, AI naming, environment variables, scratch keepalive, paths

3. **Docs components**:
   - `_components/code-block.tsx` — Copy-to-clipboard with animated icon swap (motion/react)
   - `_components/docs-layout-client.tsx` — Sidebar with AnimatePresence expand/collapse, mobile toggle, ViewTransition, orange accent active states

4. **Public markdown mirrors** (for agent/LLM consumption):
   - `public/docs/getting-started.md`
   - `public/docs/commands.md`
   - `public/docs/allocator.md`
   - `public/docs/configuration.md`

5. **`public/llms.txt`** — Machine-readable doc index pointing to markdown files.

6. **Scratch keepalive feature** (CLI):
   - Rivanna's 90-day purge policy would delete venv, env files, caches
   - rv now auto-touches all files under `.rv/` and cache dirs once per day (fire-and-forget, non-blocking)
   - Configurable via `[scratch_keepalive]` in config.toml, enabled by default
   - Rate-limited via `~/.rv/last_keepalive` timestamp file

7. **Already completed** (from earlier phases):
   - `/api/notify/route.ts` — HMAC-signed notifications (Phase 8)
   - `/api/downloads/cli/latest/[platform]/route.ts` — GitHub release proxy (Phase 10)
   - `public/install.sh` — Platform-detecting install script (Phase 10)

---

### Phase 10: CI/CD & Release Pipeline ✅

**Goal:** GitHub Actions workflow for CLI releases.

**`.github/workflows/release-cli.yml`:**

Mirror `~/all/uvacompute/.github/workflows/release-cli.yaml`:

1. Trigger: `workflow_dispatch` with version bump type (patch/minor/major) or custom version
2. Job `release`:
   - Checkout, setup bun
   - Determine new version from `apps/cli/package.json`
   - Update `package.json` version
   - Commit, tag `cli-v<version>`, push
3. Job `build` (matrix: ubuntu-latest, macos-latest):
   - Checkout at tag
   - `bun install` in `apps/cli`
   - `bun build --compile ./index.ts --outfile ./dist/<artifact>`
   - Upload artifact
   - Artifacts: `rv-linux` (ubuntu), `rv-macos` (macos)
4. Job `create-release`:
   - Download all artifacts
   - Create GitHub Release with `softprops/action-gh-release`
   - Attach binaries

**Vercel deployment:** Already handled automatically by Vercel's GitHub integration on push to `main`. No workflow needed.

**Environment variables setup:**

```bash
# One-time setup for Vercel env vars
vc env add RESEND_API_KEY          # for email notifications
vc env add GITHUB_TOKEN            # for proxying release binaries
vc env add NOTIFY_HMAC_SECRET      # for HMAC verification of notification requests

# Pull for local dev
vc env pull .env.local
```

---

### Phase 11: Testing & Hardening ✅

**Goal:** Real-world stress testing on Rivanna with actual AI researcher workloads.

**Completed work:**

Ran 8 live tests on Rivanna (MIG, A6000, 4x A6000, V100) covering GPU sanity, vLLM inference, fan-out allocation, DDP training, FSDP training, multiprocessing/DataLoader, CPU/network benchmarks, and checkpoint template verification. Full results in `apps/cli/tests/workloads/FINDINGS.md`.

**10 bugs found and fixed:**

1. **(Critical) MIG QOSMaxCpuPerJobLimit** — `cpusPerTask` was never set; auto-memory of 54G on 2TB node caused Slurm to request too many CPUs. Fixed: MIG gets `cpusPerTask=1`, memory capped at 16G.
2. **(Critical) Fast jobs vanish from squeue** — Jobs completing between monitor polls were marked FAILED. Fixed: `sacct` fallback for vanished jobs.
3. **(Critical) Launcher detection** — `torchrun --nproc_per_node=4 train.py` failed because only `commandArgs[0]` was checked for local files. Fixed: scan all non-flag args, keep launcher prefix.
4. **(High) sacct accounting lag** — Vanished jobs marked FAILED before accounting daemon writes record. Fixed: only mark FAILED if sacct has a terminal record.
5. **(High) Checkpoint strategies pruned** — `direct+timemin` incorrectly dominated checkpoint strategies in ranking. Fixed: never prune across checkpoint/non-checkpoint types.
6. **(High) Multi-node missing NODE_RANK** — torchrun can't discover node rank without `NODE_RANK=$SLURM_PROCID`. Fixed.
7. **(High) MIG auto-memory too high** — 54G calculated for MIG on 2TB node. Fixed: cap at 16G.
8. **(Medium) OMP_NUM_THREADS not set** — CPU oversubscription with multiple GPU ranks. Fixed: set to `cpusPerTask`.
9. **(Medium) TOKENIZERS_PARALLELISM warning spam** — Fixed: set `TOKENIZERS_PARALLELISM=false`.
10. **(Medium) Checkpoint TIMEOUT negative** — Possible when walltime < buffer. Fixed: floor at 60s.

**Template improvements:**

- `OMP_NUM_THREADS`, `TOKENIZERS_PARALLELISM`, `VLLM_CACHE_DIR` added to base template
- `NODE_RANK=$SLURM_PROCID` added to multi-node template
- `cpusPerTask` auto-calculated (MIG=1, others=gpusPerNode×4, max 32)
- NodeList added to sacct parsing for job tracking

**Performance baselines:**

- Scratch I/O: 1.5 GB/s (Weka), Network: 114 MB/s (~912 Mbps)
- MIG allocation: 15-20s, A6000 allocation: 11-373s (load-dependent)

**Deferred tests** (cluster fully loaded / expensive):

- Multi-node 8-GPU across 2 nodes (all strategies queued 5+ min)
- H200 allocation (100% utilization)
- MoE Mixtral inference on 4x A100 (~2000 SU)

**Test workloads** in `apps/cli/tests/workloads/`:

- 8 test directories with Python scripts + requirements.txt
- Each tests a specific CLI codepath (GPU sanity, vLLM, DDP, FSDP, multiprocess, multinode, checkpoint, MoE)

---

### Phase 12: Storage, Caching & Post-Job UX ✅

**Goal:** Shared group storage for HuggingFace models, cache deduplication, quota awareness, and post-job result discoverability.

**Completed work:**

1. **Shared group storage** (`init.ts`, `config.ts`, `types.ts`):
   - `rv init` detects `/standard/` and `/project/` group directories via `hdquota` parsing
   - Prompts user: "Share HuggingFace model cache with your lab group?"
   - Creates shared dir with `chmod g+rwxs` (setgid for group write)
   - Config: `[shared] hf_cache = "/standard/mygroup/.cache/huggingface"`
   - Threaded through full data flow: `RvConfig` → `UserRequest` → `allocator` → `TemplateOptions` → `base.ts` template

2. **Cache migration & deduplication** (`init.ts`):
   - `migrateScratchCache()`: when enabling shared storage, detects existing models in `/scratch/user/.cache/huggingface` via `du -sb`
   - Compares cache size vs available space on shared filesystem
   - Prompts user to migrate, rsyncs with `--ignore-existing`, removes scratch copy
   - Handles edge cases: already-symlinked paths, empty caches, insufficient space

3. **Quota awareness** (`init.ts`):
   - Refactored `detectGroupStorage()` to use existing `parseHdquota` parser (single SSH call returns both dirs and quotas)
   - Warns if shared filesystem >80% full with used/total/free breakdown
   - Checks available space before migration, skips if insufficient

4. **Scratch path symlink** (`init.ts` → `ensureRemoteSetup`):
   - When shared storage is active, `/scratch/user/.cache/huggingface` is symlinked to shared path
   - Both `~/.cache/huggingface` AND scratch path resolve to shared location
   - Frameworks hardcoding either path still work correctly

5. **Checkpoint path uniqueness** (`templates/base.ts`):
   - Changed from `$SLURM_JOB_NAME` to `$SLURM_JOB_NAME-$SLURM_JOB_ID`
   - Prevents collisions on repeated runs (e.g., two `rv run python train.py` → `rv-train-12345`, `rv-train-12346`)
   - Matches log file naming pattern (`{jobName}-{jobId}.out`)

6. **Post-job summary** (`run.ts`, `up.ts`):
   - After job completes, prints: workspace path, log path, checkpoint path
   - Shows exact `rv sync pull` and `rv logs --pull` commands
   - Solves discoverability — users know where results landed without guessing remote paths

7. **Extended keepalive** (`setup.ts`):
   - Daily touch now also covers `/scratch/user/.rv/checkpoints` and `/scratch/user/rv-workspaces`
   - Prevents 90-day purge from deleting checkpoints and project outputs
   - Also touches shared HF cache dir when configured

8. **Other caches stay per-user** (deliberate decision):
   - pip, uv, vllm, ray caches are small, fast to rebuild, and risk version conflicts if shared
   - Only HF models (10-200+ GB each) justify sharing

9. **OG image & social metadata** (`apps/site`):
   - Edge runtime OG image generator at `/api/og` (1200x630, IBM Plex Mono, orange accent)
   - Root layout metadata with metadataBase, openGraph, twitter card

10. **Documentation updates**:

- Configuration page updated with shared storage, migration, and quota sections
- Public markdown mirrors updated
- Sidebar nav updated with new subheadings

---

**Code Deployment & Execution Model (for `rv run` and `rv sync`):**

When `rv run train.py` is used from a local project directory:

1. `rsync` current directory to `/scratch/<user>/rv-workspaces/<dirname>/`
   - Respects `.gitignore` and `.rvignore`
   - Only syncs changed files (rsync delta)
2. Generated Slurm script `cd`s to remote workspace and runs the command
3. Workspace persists on `/scratch` for 90 days

The Slurm script handles dependency setup:

```bash
module load cuda/12.8.0 miniforge/24.11.3-py3.12
if [ -f pyproject.toml ]; then
  uv sync --frozen 2>/dev/null || uv sync
fi
if [ -f requirements.txt ]; then
  uv pip install -r requirements.txt
fi
```

Dependencies cached at `/scratch/<user>/.cache/uv`.
