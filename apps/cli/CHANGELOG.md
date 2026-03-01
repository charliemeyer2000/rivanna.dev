# Changelog

## [0.2.1](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.2.0...cli-v0.2.1) (2026-03-01)


### Fixes

* **cli:** make RV_CHECKPOINT_DIR per-job-name for cross-run resume ([#6](https://github.com/charliemeyer2000/rivanna.dev/issues/6)) ([00a317d](https://github.com/charliemeyer2000/rivanna.dev/commit/00a317d08a21c97b871c37b7fd62095019adccab))
* **cli:** show all GPUs in rv gpu + multi-node support ([#5](https://github.com/charliemeyer2000/rivanna.dev/issues/5)) ([846ebb9](https://github.com/charliemeyer2000/rivanna.dev/commit/846ebb97a32fb8cf8e85f307e6b7468ebb08e25e))

## [0.2.0](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.1.0...cli-v0.2.0) (2026-02-25)


### Features

* **cli,docs:** improve docs and UX from agent feedback ([c15090c](https://github.com/charliemeyer2000/rivanna.dev/commit/c15090c9b36ea31a47a942bdf36e0bce4917729a))

## [0.1.0](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.23...cli-v0.1.0) (2026-02-24)


### Features

* **cli, docs:** deslop + rv env import + simplifying --mig specification ([67af1da](https://github.com/charliemeyer2000/rivanna.dev/commit/67af1da4f447117834d22a0f13de9fec9f7c64f1))
* **cli, site:** changelog ([ff466f1](https://github.com/charliemeyer2000/rivanna.dev/commit/ff466f166fa10f5a5ec00e60ae690d06dfc1ed23))
* **cli:** better reapingLosers() ([4df5f6e](https://github.com/charliemeyer2000/rivanna.dev/commit/4df5f6e582dd3751c3f36069d0d2a0bbeb113671))


### Other

* **cli:** bump version to 0.0.24 ([5e25acc](https://github.com/charliemeyer2000/rivanna.dev/commit/5e25acc72b0cac45ad4308368e99f18e735c41ca))

## [0.0.23](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.22...cli-v0.0.23) (2026-02-23)

### Other

- add docs site for humans/agents ([e3a58dd](https://github.com/charliemeyer2000/rivanna.dev/commit/e3a58dd21865c31d778a7804266888f997bb62c9))

## [0.0.22](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.21...cli-v0.0.22) (2026-02-23)

_No notable changes._

## [0.0.21](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.20...cli-v0.0.21) (2026-02-22)

### Fixes

- **cli:** for commands that already sync, don't worry about venv path ([3e4cd57](https://github.com/charliemeyer2000/rivanna.dev/commit/3e4cd57e66f2a6a345aefaecc83307db350e8ef1))

## [0.0.20](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.19...cli-v0.0.20) (2026-02-22)

### Fixes

- **cli:** when no local file and running string, can do that too ([eaf4086](https://github.com/charliemeyer2000/rivanna.dev/commit/eaf4086dfbe6d1ccd366b9a0c0d584bafbfa96d8))

## [0.0.19](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.18...cli-v0.0.19) (2026-02-21)

### Features

- **cli, docs:** update cli + docs with common gotchas from usage, consolidate examples ([2aaf2d5](https://github.com/charliemeyer2000/rivanna.dev/commit/2aaf2d577e730d10b3cdb2168f4233f09bf94651))

## [0.0.18](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.17...cli-v0.0.18) (2026-02-21)

### Features

- **cli:** two-phase dependency install for CUDA packages ([54af815](https://github.com/charliemeyer2000/rivanna.dev/commit/54af8155e4be7221a0c3be3d230eb04fc6fe8f4b))

## [0.0.17](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.16...cli-v0.0.17) (2026-02-21)

### Features

- **cli:** multi-node logs, don't follow for up/run commands ([d6aa990](https://github.com/charliemeyer2000/rivanna.dev/commit/d6aa990178e780e18f19c1e2f8cc44aad2b3acc6))

## [0.0.16](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.15...cli-v0.0.16) (2026-02-21)

### Fixes

- **cli:** multi-node logging, --follow to follow only ([4223abe](https://github.com/charliemeyer2000/rivanna.dev/commit/4223abe4fb70859648e4cf838ef1dfe59628b5bb))
- **cli:** remove colors for stdout/stderr tailing slurm logs ([dc8eef0](https://github.com/charliemeyer2000/rivanna.dev/commit/dc8eef0ef49fb15fe29a1ab433d2b101e713e4f4))

## [0.0.15](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.14...cli-v0.0.15) (2026-02-21)

### Fixes

- **cli:** remove --only-binary :all: ([da2a496](https://github.com/charliemeyer2000/rivanna.dev/commit/da2a4962da99fcaded30a953a28127532641256d))

## [0.0.14](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.13...cli-v0.0.14) (2026-02-21)

### Features

- **everything:** tests + docs from learnings + tabulation + git-aware syncing ([3688bd1](https://github.com/charliemeyer2000/rivanna.dev/commit/3688bd13414d56a623d4b5679394a8eafb27bd80))

### Fixes

- **cli:** MASTER_PORT injection, temp file race, submission error logging ([03af54b](https://github.com/charliemeyer2000/rivanna.dev/commit/03af54bac6bd94c5a089215f3f275ad4557ad115))

## [0.0.13](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.12...cli-v0.0.13) (2026-02-20)

### Features

- **cli:** job grouping, start time ETAs, preflight linting, hardware retry ([5b7fcdc](https://github.com/charliemeyer2000/rivanna.dev/commit/5b7fcdc99046d3878c6343525860df2b35d5c402))

### Other

- gitignore CLI test scripts, remove from tracking ([5b31db9](https://github.com/charliemeyer2000/rivanna.dev/commit/5b31db91891e2877907cb8b709d2ad68ccae0df6))

## [0.0.12](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.11...cli-v0.0.12) (2026-02-20)

### Fixes

- **cli:** squeue parsing for pending jobs, multi-node template rewrite ([22efc13](https://github.com/charliemeyer2000/rivanna.dev/commit/22efc132be2c222aa851d4bd9eb5e604f23e23ca))

## [0.0.11](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.9...cli-v0.0.11) (2026-02-20)

### Fixes

- **cli:** MASTER_PORT in base preamble and UV_CACHE_DIR for uv installs ([4146aa9](https://github.com/charliemeyer2000/rivanna.dev/commit/4146aa90aa59954067baccad175c76ab49da8d9a))

## [0.0.9](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.8...cli-v0.0.9) (2026-02-19)

### Fixes

- **cli:** multi-GPU hardening, delete dead Ray template, add --node flag ([e6b2656](https://github.com/charliemeyer2000/rivanna.dev/commit/e6b2656a5b675f123ab39e78950213c8a8571532))
- **cli:** comprehensive Slurm state handling, exit code propagation, and CLI hardening ([b738f1b](https://github.com/charliemeyer2000/rivanna.dev/commit/b738f1b98b29e069c9190556a5ae280bc975047e))
- **cli:** use scontrol for instant vanished-job detection ([d1e7dda](https://github.com/charliemeyer2000/rivanna.dev/commit/d1e7ddacc8509c6e8b3a911878796ec6ea14f3f1))
- **cli:** proper POSIX shell quoting and faster job failure detection ([f59c2ec](https://github.com/charliemeyer2000/rivanna.dev/commit/f59c2ec7effe478caca5e0370bfb2fb0c1916c92))
- **cli:** preserve quotes in rv run command arguments ([baf2569](https://github.com/charliemeyer2000/rivanna.dev/commit/baf256926dfa9e504ebfacd2bd3f85775bb2e783))

## [0.0.8](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.6...cli-v0.0.8) (2026-02-19)

### Fixes

- **cli:** inject env vars into srun interactive sessions ([37d2b51](https://github.com/charliemeyer2000/rivanna.dev/commit/37d2b514c5d01056539d299c59998fcaa281ef51))

## [0.0.6](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.5...cli-v0.0.6) (2026-02-19)

### Fixes

- **cli:** use sleep infinity for interactive job keepalive ([c1de90b](https://github.com/charliemeyer2000/rivanna.dev/commit/c1de90bfcd055b0db7bb1183e87ea037d31d1da0))

## [0.0.5](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.4...cli-v0.0.5) (2026-02-19)

### Features

- **cli:** add upgrade notifications and rv upgrade command ([20d422e](https://github.com/charliemeyer2000/rivanna.dev/commit/20d422e2735f79707e8290feff569f10bbd171ab))

### Other

- **cli:** merge attach into ssh, remove --run from up ([347c7d8](https://github.com/charliemeyer2000/rivanna.dev/commit/347c7d8c4e0155593ca882e1230eb6d8a6af71db))

## [0.0.4](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.3...cli-v0.0.4) (2026-02-19)

### Features

- **cli:** post-job summary and extended keepalive coverage ([4a74170](https://github.com/charliemeyer2000/rivanna.dev/commit/4a74170884a41be2035856f79a56552be62f7293))
- **cli:** add shared group storage for HuggingFace model cache ([add402b](https://github.com/charliemeyer2000/rivanna.dev/commit/add402bb90e47be89463fca37cf42b74a9837197))
- **cli:** add scratch keepalive to prevent 90-day purge ([886c371](https://github.com/charliemeyer2000/rivanna.dev/commit/886c371194f7f42a3d63e45c6964fde71f82c084))
- add HMAC-signed email notifications via Resend (Phase 8) ([5e2b666](https://github.com/charliemeyer2000/rivanna.dev/commit/5e2b666fd9786b52f94d6732a5791f63e5b9108f))
- **cli:** resumable init, shell detection, and VPN status ([f4db99c](https://github.com/charliemeyer2000/rivanna.dev/commit/f4db99c706e4cf45d5cd85e8832ffa635317c0ef))
- **cli:** smart execution, GPU verification, and auto-memory (Phase 8) ([915b589](https://github.com/charliemeyer2000/rivanna.dev/commit/915b58981892d610d171bdb216f10b066554c393))
- **cli:** add --mem flag and vLLM stress test ([ab0c5f4](https://github.com/charliemeyer2000/rivanna.dev/commit/ab0c5f44cf064ba539f652f4b02c36ac7683e940))
- **cli:** add supporting commands and infrastructure (Phase 7) ([6998f6c](https://github.com/charliemeyer2000/rivanna.dev/commit/6998f6ced4f900a0f1b38ada18b984e1db2c2dbf))
- **cli:** add core commands — up, run, ps, stop, attach ([9438e84](https://github.com/charliemeyer2000/rivanna.dev/commit/9438e842ab4026e7e07367ae54ebf56bed8ba41f))
- **cli:** add allocator with fan-out strategy engine ([cc4576f](https://github.com/charliemeyer2000/rivanna.dev/commit/cc4576fa85e37af6c841de1eb55305377bb02a9c))
- **cli:** add Slurm parsers, templates, and SlurmClient wrapper ([d7bfffb](https://github.com/charliemeyer2000/rivanna.dev/commit/d7bfffb4b88bb7f603f9a4f09ec72b8d3e2a9a32))

### Fixes

- **cli:** include job ID in checkpoint path to prevent collisions ([0e3b4cc](https://github.com/charliemeyer2000/rivanna.dev/commit/0e3b4cccb34f3140075ff5dc80c44065c800880b))
- **cli:** add HF cache migration and quota checks for shared storage ([3984910](https://github.com/charliemeyer2000/rivanna.dev/commit/39849105842579ce5821e4f2df4f713bafd0408a))
- **cli:** harden allocator, templates, and smart execution (Phase 11) ([225c13b](https://github.com/charliemeyer2000/rivanna.dev/commit/225c13bf29b69e87e211a032c0a267137e723e40))
- **cli:** squeue visibility, AI naming config, forward PID tracking ([f4af4b4](https://github.com/charliemeyer2000/rivanna.dev/commit/f4af4b443fb85a56acfbca7630e5d22ee7d6d035))

## [0.0.3](https://github.com/charliemeyer2000/rivanna.dev/compare/cli-v0.0.2...cli-v0.0.3) (2026-02-18)

_No notable changes._

## [0.0.2](https://github.com/charliemeyer2000/rivanna.dev/releases/tag/cli-v0.0.2) (2026-02-18)

### Features

- **cli:** add SSH layer, config system, and rv init command ([49904f8](https://github.com/charliemeyer2000/rivanna.dev/commit/49904f8e7c982be53db21f780539d2fd3b8eb675))
- scaffold monorepo with CLI, site, and shared package ([3d3b6ed](https://github.com/charliemeyer2000/rivanna.dev/commit/3d3b6ed9bbff75ba5f0940f5c96de287470684d2))
