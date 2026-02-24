# commands

full reference for all rv commands. every command supports `--json` for scripted output.

## rv up

Allocate GPUs on Rivanna and attach an interactive shell. Probes the cluster, generates strategies across all compatible GPU types and partitions, submits them in parallel, and drops you into a shell when the first allocation starts running. Use `rv run` for batch jobs.

```bash
rv up -g 2 -t a100 --time 8h
```

| flag                | description                                           | default        |
| ------------------- | ----------------------------------------------------- | -------------- |
| `-g, --gpu <n>`     | number of GPUs                                        | 1              |
| `-t, --type <type>` | GPU type (a100, a6000, a40, h200, v100, rtx3090, mig) | —              |
| `--time <duration>` | total time needed (e.g. 2h, 24h, 3d)                  | 2:59:00        |
| `--name <name>`     | job name                                              | auto-generated |
| `--mem <size>`      | total CPU memory (e.g. 200G)                          | auto           |
| `--mig`             | shortcut for --gpu 1 --type mig (free, instant)       | —              |
| `--dry-run`         | show strategies without submitting                    | —              |

```bash
rv up --mig              # free MIG slice, instant
rv up --dry-run          # preview strategies
```

## rv run

Run a command on Rivanna GPUs. Syncs local files to a git-aware workspace, creates an immutable snapshot, submits strategies across compatible GPU types, and exits. by default, returns immediately after submission — use `rv ps` to check status and `rv logs -f` to follow output. pass `-f` to wait for allocation and tail logs inline. losing strategies from fan-out are automatically cleaned up by `rv ps`.

**Important: argument ordering.** rv options must come BEFORE the command. Options placed after the command are passed through to it silently. rv will warn if it detects misplaced flags.

```bash
# correct — options before command
rv run -g 4 -t a100 python train.py

# wrong — -g 4 becomes a python argument
rv run python train.py -g 4 -t a100
```

`rv run` uploads the current working directory as the job workspace. Only git-tracked files are synced (respects `.gitignore`). You can add a `.rvignore` file to exclude additional files.

```bash
rv run python train.py
```

| flag                   | description                                                              | default        |
| ---------------------- | ------------------------------------------------------------------------ | -------------- |
| `-g, --gpu <n>`        | number of GPUs                                                           | 1              |
| `-t, --type <type>`    | GPU type                                                                 | —              |
| `--time <duration>`    | total time needed                                                        | 2:59:00        |
| `--name <name>`        | job name                                                                 | auto-generated |
| `--mem <size>`         | total CPU memory                                                         | auto           |
| `--mig`                | shortcut for --gpu 1 --type mig (free)                                   | —              |
| `-o, --output <paths>` | copy these paths from snapshot to persistent storage after job completes | —              |
| `--single-node`        | force single-node allocation (no multi-node strategies)                  | —              |
| `-f, --follow`         | wait for allocation and tail logs                                        | —              |

```bash
rv run -g 4 -t a100 python train.py
rv run -f torchrun --nproc_per_node=4 train.py   # wait + tail logs
rv run --output ./artifacts python train.py       # auto-copy artifacts after job
rv run -g 4 --single-node python generate.py      # force single-node (inference)
```

## rv ps

Also available as `rv ls`.

List your jobs on Rivanna. Shows job ID, name, state, GPU type, node, and elapsed time. when git metadata is available, displays the branch and commit hash alongside each job group. automatically cancels losing fan-out strategies when a winner starts running.

```bash
rv ps
```

| flag        | description                                 |
| ----------- | ------------------------------------------- |
| `-a, --all` | include completed/failed jobs (last 7 days) |

## rv stop

Also available as `rv cancel`.

Cancel jobs on Rivanna. Accepts a job ID or job name. When cancelling a job that's part of a fan-out strategy group, rv will show all sibling strategies and offer to cancel them together. use `rv stop` instead of `scancel` to avoid orphaning strategies.

```bash
rv stop 12345              # cancel by ID (prompts to cancel siblings)
rv stop my-job-name        # cancel by name (all strategies)
rv stop --all              # cancel everything
```

| flag        | description                                  |
| ----------- | -------------------------------------------- |
| `-a, --all` | cancel all your jobs (requires confirmation) |

## rv ssh

Attach to a running job's compute node. Defaults to the most recent running job if no ID is given. Use `--config` to print an SSH config entry for VS Code or Cursor.

```bash
rv ssh                   # attach to most recent running job
rv ssh 12345             # attach to specific job
rv ssh 12345 --node 1    # attach to second node (multi-node jobs)
rv ssh --config          # print SSH config for VS Code / Cursor
```

## rv logs

View job output logs. Defaults to the most recent job. Automatically follows output for running jobs.

```bash
rv logs
```

| flag             | description                                   | default               |
| ---------------- | --------------------------------------------- | --------------------- |
| `--err`          | show stderr instead of stdout                 | —                     |
| `--pull`         | download log files locally                    | —                     |
| `-f, --follow`   | follow log output                             | auto for running jobs |
| `--node <index>` | show specific node's output (multi-node jobs) | —                     |

```bash
rv logs 12345 --err     # view stderr
rv logs --pull          # download log files
rv logs 12345 --node 1  # view node 1 output (multi-node)
```

## rv status

Dashboard showing cluster status: connection health, Slurm account, storage usage, active jobs, port forwards, and GPU availability across all partitions.

```bash
rv status
```

## rv sync

Sync files between your machine and Rivanna using rsync. Three subcommands: push, pull, and watch. when run from a git repo without an explicit remote path, rv automatically targets the current branch's workspace (`{project}/{branch}/code`).

### sync push

Push local files to Rivanna. Defaults to current directory. without a remote path, syncs to the git-aware workspace path.

```bash
rv sync push                                   # syncs to {project}/{branch}/code
rv sync push ./src /scratch/user/project       # explicit remote path
rv sync push --dry-run                         # preview what would be synced
```

### sync pull

Pull remote files to your machine.

```bash
rv sync pull /scratch/user/results
rv sync pull /scratch/user/results ./data
```

### sync watch

Watch local directory and auto-push on changes. uses the same git-aware default path as push.

```bash
rv sync watch
rv sync watch ./src
```

| flag        | description                                |
| ----------- | ------------------------------------------ |
| `--dry-run` | show what would be synced (push/pull only) |

## rv forward

Forward ports from a running job to your local machine. Useful for Jupyter, TensorBoard, Ray Dashboard, and other web UIs.

```bash
rv forward 8888
```

| flag                | description                                          |
| ------------------- | ---------------------------------------------------- |
| `--auto`            | auto-detect common ports (Ray, Jupyter, TensorBoard) |
| `-l, --list`        | list active forwards                                 |
| `-s, --stop [port]` | stop a forward (or all if no port given)             |
| `--node <index>`    | node index for multi-node jobs (default: 0)          |

```bash
rv forward --auto     # detect + forward all
rv forward --list     # show active forwards
rv forward --stop     # stop all forwards
```

## rv env

Manage environment variables that are injected into every job. Useful for API keys and other secrets. Sensitive values are masked in display.

Environment variables are **global** — they apply to all projects and branches. Use them for credentials and identity (API keys, tokens). For experiment-specific config, use config files (Hydra, argparse, YAML) which are git-tracked and per-branch by design.

### env set

```bash
rv env set HF_TOKEN hf_abc123...
rv env set OPENAI_API_KEY sk-...
```

### env import

Bulk-import variables from a `.env` file. Reads the file locally and stores each key via `rv env set`. Existing keys are overwritten. Defaults to `.env` in the current directory.

```bash
rv env import             # imports .env
rv env import .env.prod   # imports a specific file
```

### env list

```bash
rv env list
```

### env rm

```bash
rv env rm HF_TOKEN
```

## rv cost

Estimate SU (Service Unit) cost for a job configuration. Shows cost across all GPU types if no type is specified. MIG is always free.

```bash
rv cost -g 4 -t a100 --time 24h
```

| flag                | description    | default |
| ------------------- | -------------- | ------- |
| `-g, --gpu <n>`     | number of GPUs | 1       |
| `-t, --type <type>` | GPU type       | —       |
| `--time <duration>` | time duration  | 2:59:00 |

## rv exec

Run a command on the Rivanna login node (no GPU allocation). Useful for checking SU balance, listing files, or quick remote operations.

```bash
rv exec allocations
rv exec ls /scratch/user
rv exec which python
```

## rv gpu

Show GPU utilization for a running job via nvidia-smi. Defaults to the most recent running job if no ID is given.

```bash
rv gpu
rv gpu 12345    # specific job
```

## rv upgrade

Check for a newer version and upgrade the rv CLI in place. Downloads the latest binary via the install script.

```bash
rv upgrade
```

## rv init

Interactive setup wizard. Configures your computing ID, SSH keys, VPN check, Slurm account, and remote environment. Run once after installing.

```bash
rv init
```

| flag      | description                             |
| --------- | --------------------------------------- |
| `--force` | re-run setup even if already configured |
