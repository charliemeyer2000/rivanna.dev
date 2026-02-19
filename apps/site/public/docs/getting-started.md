# getting started

rv is a CLI for running GPU jobs on UVA's Rivanna cluster. no SLURM scripts, no partition guessing — one command to submit.

## install

run this in your terminal (macOS or Linux):

```bash
curl -fsSL https://rivanna.dev/install.sh | bash
```

installs to `~/.local/bin/rv`. supports macOS (x86_64, arm64) and Linux (x86_64).

## setup

run the interactive setup wizard:

```bash
rv init
```

this will ask for your UVA computing ID, check VPN connectivity, set up SSH keys, discover your Slurm account, and configure the remote environment. you need to be connected to the [UVA Anywhere VPN](https://virginia.service-now.com/its?id=itsweb_kb_article&sys_id=f24e5cdfdb3acb804f32fb671d9619d0).

## first job

try a free MIG GPU slice (no SU cost, instant allocation):

```bash
rv up --mig
```

or run a script in batch mode:

```bash
rv run python train.py
```

check your cluster status:

```bash
rv status
```

## what's next?

- [commands](./commands.md) — full reference for all 14 rv commands
- [smart allocator](./allocator.md) — how fan-out strategy and backfill detection work
- [configuration](./configuration.md) — config file, environment variables, notifications
