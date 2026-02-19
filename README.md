# rivanna.dev

[rivanna.dev](https://rivanna.dev) is a simple cli to wrap uva's hpc cluster (Rivanna/Afton). this makes managing slurm, jobs/clusters, environment variables, dependencies, cuda, and all the annoying stuff much easier.

The goal is for you, the researcher, to _just write code_ and manage dependencies locally, and then run everything on uva hpc and it _just works_. No struggling managing checkpointing, environment variables, logs, cuda, etc. We also [optimize slurm queries](https://rivanna.dev/allocator) for you to try to get you an allocation as quickly as possible.

## Installation

Run this command to install the rivanna cli.

```
curl -fsSL https://rivanna.dev/install.sh | bash
```

Once installed, run `rv` init to set up ssh connection and coniguring your vpn, additional allocations, etc.

## Usage

Please refer to the [documentation](https://rivanna.dev/docs) for in-depth documentation on how to use the `rv` cli. this is an opinionated cli.

## Agents

Coding agents can easily use the `rv` cli. For documentation, point them to the [llms.txt](https://rivanna.dev/llms.txt), or for any docs page, append `.md` to it to return the documentation in markdown form.

Moreover, appending `--json` to any command returns it in json form for coding agents to easily use the cli on your behalf.
