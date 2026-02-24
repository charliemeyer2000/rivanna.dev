# rivanna.dev

[rivanna.dev](https://rivanna.dev) is a simple cli to wrap uva's hpc cluster (Rivanna/Afton). this makes managing slurm, jobs/clusters, environment variables, dependencies, cuda, and all the annoying stuff much easier.

The goal is for you, the researcher, to _just write code_ and manage dependencies locally, and then run everything on uva hpc and it _just works_. No struggling managing checkpointing, environment variables, logs, cuda, etc. We also [optimize slurm queries](https://rivanna.dev/allocator) for you to try to get you an allocation as quickly as possible.

## Installation

Run this command to install the rivanna cli.

```
curl -fsSL https://rivanna.dev/install.sh | bash
```

Once installed, run `rv init` to set up ssh connection and configuring your vpn, additional allocations, etc.

## Usage

Please refer to the [documentation](https://rivanna.dev/docs) for in-depth documentation on how to use the `rv` cli. this is an opinionated cli.

## Agents

Coding agents can easily use the `rv` cli. For documentation, point them to the [llms.txt](https://rivanna.dev/llms.txt), or for any docs page, append `.md` to it to return the documentation in markdown form.

Moreover, appending `--json` to any command returns it in json form for coding agents to easily use the cli on your behalf.

## Contributing

### Prerequisites

- [Node.js](https://nodejs.org) (v20+)
- [pnpm](https://pnpm.io) (v10+)
- [Bun](https://bun.sh) (for CLI compilation)

### Setup

```bash
git clone https://github.com/charliemeyer2000/rivanna.dev.git
cd rivanna.dev
pnpm install
```

`pnpm install` runs `husky` via the `prepare` script, which sets up git hooks automatically. This includes:

- **pre-commit**: runs `prettier` on staged files via `lint-staged`
- **commit-msg**: enforces [conventional commits](https://www.conventionalcommits.org) via `commitlint`

All commit messages must follow the format `type(scope): description`. Examples:

```
feat(cli): add new command
fix(cli): handle edge case in log parsing
chore(site): update dependencies
docs: update README
```

Valid types: `feat`, `fix`, `chore`, `docs`, `refactor`, `revert`, `test`, `ci`, `perf`, `style`, `build`. Scope is optional. This matters because [release-please](https://github.com/googleapis/release-please) uses these prefixes to determine version bumps (`feat` = minor, `fix` = patch, `!` = major) and to generate the [changelog](https://rivanna.dev/docs/changelog).

### Project structure

```
apps/cli/          # rv CLI (Commander.js, compiled with Bun)
apps/site/         # docs site (Next.js 16, deployed on Vercel)
packages/shared/   # shared types and constants
```

### Development

```bash
pnpm dev:cli       # watch mode for CLI
pnpm dev:site      # Next.js dev server with Turbopack
pnpm run build     # build everything (turbo)
pnpm check-types   # typecheck all packages
```

Run the CLI locally without compiling:

```bash
bun run apps/cli/index.ts <command>
```

### Site deployment

The site deploys to [rivanna.dev](https://rivanna.dev) via Vercel, connected to `charliemeyer2000`'s personal Vercel account. Every push to `main` triggers a production deploy. PRs get preview deploys automatically.

The site needs a `.env.local` in `apps/site/` with credentials for the notification API (Resend). Not required for local development of docs pages.

### CLI releases

Releases are fully automated via [release-please](https://github.com/googleapis/release-please):

1. Push conventional commits to `main`
2. release-please opens (or updates) a Release PR that accumulates changelog entries
3. Merge the Release PR when you're ready to ship
4. release-please creates a GitHub Release, tags it (`cli-v*`), bumps `package.json`, and updates `CHANGELOG.md`
5. The same workflow then builds linux and macOS binaries and uploads them to the release
6. Users get the new version via `rv upgrade`

No manual version bumping, tagging, or binary uploading needed.
