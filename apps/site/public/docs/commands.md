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

Run a command on Rivanna GPUs. Allocates, syncs local files, submits the job, and streams output until completion. Detects local files in the command and automatically syncs them to the remote workspace.

```bash
rv run python train.py
```

| flag                | description                            | default        |
| ------------------- | -------------------------------------- | -------------- |
| `-g, --gpu <n>`     | number of GPUs                         | 1              |
| `-t, --type <type>` | GPU type                               | —              |
| `--time <duration>` | total time needed                      | 2:59:00        |
| `--name <name>`     | job name                               | auto-generated |
| `--mem <size>`      | total CPU memory                       | auto           |
| `--mig`             | shortcut for --gpu 1 --type mig (free) | —              |

```bash
rv run -g 4 -t a100 python train.py
rv run torchrun --nproc_per_node=4 train.py
```

## rv ps

List your jobs on Rivanna. Shows job ID, name, state, GPU type, node, and elapsed time.

```bash
rv ps
```

| flag        | description                                 |
| ----------- | ------------------------------------------- |
| `-a, --all` | include completed/failed jobs (last 7 days) |

## rv stop

Cancel jobs on Rivanna. Pass a job ID to cancel a specific job, or use --all to cancel everything.

```bash
rv stop 12345
rv stop --all    # cancel everything
```

| flag        | description                                  |
| ----------- | -------------------------------------------- |
| `-a, --all` | cancel all your jobs (requires confirmation) |

## rv ssh

Attach to a running job's compute node. Defaults to the most recent running job if no ID is given. Use `--config` to print an SSH config entry for VS Code or Cursor.

```bash
rv ssh                   # attach to most recent running job
rv ssh 12345             # attach to specific job
rv ssh --config          # print SSH config for VS Code / Cursor
```

## rv logs

View job output logs. Defaults to the most recent job. Automatically follows output for running jobs.

```bash
rv logs
```

| flag           | description                   | default               |
| -------------- | ----------------------------- | --------------------- |
| `--err`        | show stderr instead of stdout | —                     |
| `--pull`       | download log files locally    | —                     |
| `-f, --follow` | follow log output             | auto for running jobs |

```bash
rv logs 12345 --err     # view stderr
rv logs --pull          # download log files
```

## rv status

Dashboard showing cluster status: connection health, Slurm account, storage usage, active jobs, port forwards, and GPU availability across all partitions.

```bash
rv status
```

## rv sync

Sync files between your machine and Rivanna using rsync. Three subcommands: push, pull, and watch.

### sync push

Push local files to Rivanna. Defaults to current directory.

```bash
rv sync push
rv sync push ./src /scratch/user/project
rv sync push --dry-run    # preview what would be synced
```

### sync pull

Pull remote files to your machine.

```bash
rv sync pull /scratch/user/results
rv sync pull /scratch/user/results ./data
```

### sync watch

Watch local directory and auto-push on changes.

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

```bash
rv forward --auto     # detect + forward all
rv forward --list     # show active forwards
rv forward --stop     # stop all forwards
```

## rv env

Manage environment variables that are injected into every job. Useful for API keys, model paths, and other secrets. Sensitive values are masked in display.

### env set

```bash
rv env set HF_TOKEN hf_abc123...
rv env set MODEL_PATH /scratch/models
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

## rv init

Interactive setup wizard. Configures your computing ID, SSH keys, VPN check, Slurm account, and remote environment. Run once after installing.

```bash
rv init
```

| flag      | description                             |
| --------- | --------------------------------------- |
| `--force` | re-run setup even if already configured |
