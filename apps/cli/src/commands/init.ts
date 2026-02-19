import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import ora from "ora";
import { confirm, input, select } from "@inquirer/prompts";
import type { RvConfig, StorageQuota } from "@rivanna/shared";
import { PATHS } from "@rivanna/shared";
import { SSHClient } from "@/core/ssh.ts";
import { saveConfig, loadConfig } from "@/core/config.ts";
import { parseHdquota } from "@/parsers/hdquota.ts";
import { theme } from "@/lib/theme.ts";
import {
  SSH_DIR,
  SSH_KEY_PATH,
  SSH_SOCKETS_DIR,
  SSH_CONFIG_PATH,
  SSH_HOST_ALIAS,
  DEFAULT_HOSTNAME,
  SSH_CONFIG_MARKER_START,
  SSH_CONFIG_MARKER_END,
  CACHE_ENV_EXPORTS,
  BASHRC_MARKER_START,
  BASHRC_MARKER_END,
} from "@/lib/constants.ts";

// SSH key files to look for, in preference order
const SSH_KEY_CANDIDATES = [
  "id_ed25519",
  "id_rsa",
  "id_ecdsa",
  "id_ecdsa_sk",
  "id_ed25519_sk",
];

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Set up rv for first-time use")
    .option("--force", "Re-run setup even if already configured")
    .action(async (options) => {
      try {
        await runInit(options);
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes("User force closed")) {
            console.log("\n");
            process.exit(0);
          }
          console.error(theme.error(`\nSetup failed: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

// ═══════════════ Connectivity Helpers ═══════════════

function findExistingKeys(): { name: string; path: string }[] {
  const keys: { name: string; path: string }[] = [];
  for (const name of SSH_KEY_CANDIDATES) {
    const keyPath = join(SSH_DIR, name);
    if (existsSync(keyPath) && existsSync(`${keyPath}.pub`)) {
      keys.push({ name, path: keyPath });
    }
  }
  return keys;
}

async function testKeyAuth(
  host: string,
  user: string,
  keyPath?: string,
): Promise<boolean> {
  const args = [
    "ssh",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=accept-new",
  ];
  if (keyPath) args.push("-i", keyPath);
  args.push(`${user}@${host}`, "echo ok");

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return exitCode === 0 && stdout.trim() === "ok";
}

export async function testConnectivity(target: string): Promise<boolean> {
  const proc = Bun.spawn(
    [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      "-o",
      "StrictHostKeyChecking=accept-new",
      target,
      "echo ok",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode === 0) return true;
  const err = stderr.toLowerCase();
  return !(
    err.includes("could not resolve") ||
    err.includes("connection refused") ||
    err.includes("connection timed out") ||
    err.includes("network is unreachable")
  );
}

// ═══════════════ SSH Key Management ═══════════════

async function generateSSHKey(user: string): Promise<string> {
  const spinner = ora("Generating SSH key...").start();
  if (!existsSync(SSH_DIR)) {
    mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });
  }

  const proc = Bun.spawnSync(
    [
      "ssh-keygen",
      "-t",
      "ed25519",
      "-f",
      SSH_KEY_PATH,
      "-N",
      "",
      "-C",
      `rv-${user}`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  if (proc.exitCode !== 0) {
    spinner.fail("Failed to generate SSH key");
    console.log(theme.error(proc.stderr.toString()));
    process.exit(1);
  }
  spinner.succeed("SSH key generated at ~/.ssh/id_ed25519");
  return SSH_KEY_PATH;
}

async function copyKeyToRivanna(
  keyPath: string,
  user: string,
  hostname: string,
): Promise<void> {
  console.log(
    theme.muted(
      "\nCopying SSH key to Rivanna...\nYou'll enter your UVA password (one time only).\n",
    ),
  );

  for (let attempt = 1; attempt <= 3; attempt++) {
    const proc = Bun.spawn(
      [
        "ssh-copy-id",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-i",
        `${keyPath}.pub`,
        `${user}@${hostname}`,
      ],
      { stdio: ["inherit", "inherit", "inherit"] },
    );
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      console.log(theme.success("SSH key copied to Rivanna!"));
      return;
    }

    if (attempt < 3) {
      console.log(
        theme.warning(
          `\nFailed (attempt ${attempt}/3). Check your password and try again.\n`,
        ),
      );
    }
  }

  console.log(theme.error("\nFailed to copy SSH key after 3 attempts."));
  console.log(
    theme.muted("  Make sure you're using your UVA password (not Duo)."),
  );
  console.log(
    theme.muted(
      `  Manual: ssh-copy-id -i ${keyPath}.pub ${user}@${hostname}\n`,
    ),
  );
  process.exit(1);
}

// ═══════════════ SSH Config ═══════════════

function writeSSHConfig(user: string, hostname: string, keyPath: string): void {
  if (!existsSync(SSH_DIR)) {
    mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(SSH_SOCKETS_DIR)) {
    mkdirSync(SSH_SOCKETS_DIR, { recursive: true, mode: 0o700 });
  }

  const block = [
    SSH_CONFIG_MARKER_START,
    `Host ${SSH_HOST_ALIAS}`,
    `    HostName ${hostname}`,
    `    User ${user}`,
    `    ControlMaster auto`,
    `    ControlPath ${SSH_SOCKETS_DIR}/${SSH_HOST_ALIAS}-%r@%h-%p`,
    `    ControlPersist 30m`,
    `    ServerAliveInterval 60`,
    `    IdentityFile ${keyPath}`,
    SSH_CONFIG_MARKER_END,
  ].join("\n");

  let config = "";
  if (existsSync(SSH_CONFIG_PATH)) {
    config = readFileSync(SSH_CONFIG_PATH, "utf-8");
  }

  // Remove any existing rv-hpc block (idempotent)
  const regex = new RegExp(
    `${escapeRegex(SSH_CONFIG_MARKER_START)}[\\s\\S]*?${escapeRegex(SSH_CONFIG_MARKER_END)}`,
    "g",
  );
  config = config.replace(regex, "").trim();
  config = config + "\n\n" + block + "\n";
  writeFileSync(SSH_CONFIG_PATH, config, { mode: 0o600 });
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ═══════════════ Slurm Account Discovery ═══════════════

function parseAccountsFromAllocations(
  output: string,
): { name: string; balance: number }[] {
  const accounts: { name: string; balance: number }[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("-") || trimmed.startsWith("Account"))
      continue;
    // Matches: account_name   allocation   used   balance
    const match = trimmed.match(/^(\S+)\s+(\d+)\s+\d+\s+(\d+)/);
    if (match) {
      accounts.push({ name: match[1]!, balance: parseInt(match[3]!, 10) });
    }
  }
  return accounts;
}

// ═══════════════ Group Storage Detection ═══════════════

/** Format bytes as human-readable string (e.g., "18.5 TB", "200.0 GB") */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${bytes} B`;
}

/**
 * Detect shared group directories the user has access to.
 * Uses parseHdquota for /standard/ and /project/ mounts.
 * Returns both group dirs and full quota data for capacity checks.
 */
async function detectGroupStorage(
  ssh: SSHClient,
): Promise<{ dirs: { path: string; type: string }[]; quotas: StorageQuota[] }> {
  try {
    const output = await ssh.exec("hdquota 2>/dev/null || true");
    const quotas = parseHdquota(output);
    const dirs = quotas
      .filter((q) => /^\/(?:standard|project)\//.test(q.mountPoint))
      .map((q) => ({ path: q.mountPoint, type: q.type }));
    return { dirs, quotas };
  } catch {
    return { dirs: [], quotas: [] };
  }
}

/**
 * Migrate existing scratch HF cache data to shared storage.
 * Non-fatal: if anything fails, the init flow continues.
 */
async function migrateScratchCache(
  ssh: SSHClient,
  scratchHf: string,
  sharedHfPath: string,
  quota: StorageQuota | undefined,
): Promise<void> {
  try {
    // If scratch path is already a symlink, nothing to migrate
    const linkCheck = await ssh.exec(
      `[ -L "${scratchHf}" ] && echo "symlink" || echo "not"`,
    );
    if (linkCheck.trim() === "symlink") return;

    // Check if scratch HF cache has content
    const duOutput = await ssh.exec(
      `du -sb "${scratchHf}" 2>/dev/null | cut -f1 || echo 0`,
    );
    const cacheBytes = parseInt(duOutput.trim(), 10) || 0;
    if (cacheBytes < 1024) return;

    console.log(
      theme.muted(
        `\n  Found ${formatBytes(cacheBytes)} of models in ${scratchHf}`,
      ),
    );

    // Check if there's enough space on shared storage
    if (quota) {
      const freeBytes = quota.totalBytes - quota.usedBytes;
      if (cacheBytes > freeBytes) {
        console.log(
          theme.warning(
            `  Not enough space: cache is ${formatBytes(cacheBytes)} but shared storage only has ${formatBytes(freeBytes)} free.`,
          ),
        );
        console.log(
          theme.muted(
            "  Skipping migration. Your scratch cache will remain — new downloads go to shared.",
          ),
        );
        return;
      }
    }

    const doMigrate = await confirm({
      message: `Migrate ${formatBytes(cacheBytes)} of models to shared storage? (frees scratch space)`,
      default: true,
    });
    if (!doMigrate) return;

    const migrateSpinner = ora(
      `Migrating models (${formatBytes(cacheBytes)})...`,
    ).start();
    try {
      await ssh.exec(
        `rsync -a --ignore-existing "${scratchHf}/" "${sharedHfPath}/" && rm -rf "${scratchHf}"`,
        { timeoutMs: 300_000 },
      );
      migrateSpinner.succeed("Models migrated to shared storage");
    } catch {
      migrateSpinner.warn(
        "Migration incomplete (non-fatal). Models remain in scratch.",
      );
    }
  } catch {
    // du/stat failures shouldn't block init
  }
}

// ═══════════════ Remote Environment Setup ═══════════════

/**
 * Idempotent remote setup: creates directories, symlinks caches,
 * and writes env vars to the correct shell rc file(s).
 * Returns the detected remote shell name.
 */
async function ensureRemoteSetup(
  ssh: SSHClient,
  user: string,
  sharedHfCache?: string,
): Promise<string> {
  // Create all required directories
  const dirs = [
    PATHS.cache.uv(user),
    PATHS.cache.pip(user),
    PATHS.rvDir(user),
    PATHS.logs(user),
    PATHS.envFiles(user),
    PATHS.envs(user),
    PATHS.workspaces(user),
  ];
  // Only create scratch HF dir if NOT using shared storage
  if (!sharedHfCache) dirs.push(PATHS.cache.hf(user));
  if (sharedHfCache) dirs.push(sharedHfCache);
  await ssh.exec(`mkdir -p ${dirs.join(" ")}`);

  // When using shared storage, make scratch HF path a symlink to shared
  // so any tool hardcoding /scratch/user/.cache/huggingface still works
  if (sharedHfCache) {
    const scratchHf = PATHS.cache.hf(user);
    await ssh.exec(
      `if [ -d "${scratchHf}" ] && [ ! -L "${scratchHf}" ]; then ` +
        `rm -rf "${scratchHf}" && ln -s "${sharedHfCache}" "${scratchHf}"; ` +
        `elif [ ! -e "${scratchHf}" ]; then ` +
        `ln -s "${sharedHfCache}" "${scratchHf}"; ` +
        `elif [ -L "${scratchHf}" ]; then ` +
        `rm "${scratchHf}" && ln -s "${sharedHfCache}" "${scratchHf}"; fi`,
    );
  }

  // Symlink ~/.cache/huggingface → the active HF cache so all tools share one location
  const hfTarget = sharedHfCache ?? PATHS.cache.hf(user);
  await ssh.exec(
    `if [ -d ~/.cache/huggingface ] && [ ! -L ~/.cache/huggingface ]; then ` +
      `rsync -a --ignore-existing ~/.cache/huggingface/ ${hfTarget}/ && ` +
      `rm -rf ~/.cache/huggingface && ` +
      `ln -s ${hfTarget} ~/.cache/huggingface; ` +
      `elif [ ! -e ~/.cache/huggingface ]; then ` +
      `mkdir -p ~/.cache && ln -s ${hfTarget} ~/.cache/huggingface; ` +
      `elif [ -L ~/.cache/huggingface ]; then ` +
      `rm ~/.cache/huggingface && ln -s ${hfTarget} ~/.cache/huggingface; fi`,
  );

  // Detect remote login shell
  const remoteShell = await ssh.exec('basename "$SHELL"').catch(() => "bash");
  const shell = remoteShell.trim();

  // Build env export lines (bash/zsh syntax)
  const exportLines = CACHE_ENV_EXPORTS(user, sharedHfCache);

  // Always write to .bashrc — Slurm batch scripts source it
  await upsertShellBlock(ssh, "~/.bashrc", exportLines);

  // If remote shell is zsh, also write to .zshrc for interactive sessions
  if (shell === "zsh") {
    await upsertShellBlock(ssh, "~/.zshrc", exportLines);
  }

  // If fish, write with fish syntax to config.fish
  if (shell === "fish") {
    await ssh.exec("mkdir -p ~/.config/fish");
    const hfHome = sharedHfCache ?? `/scratch/${user}/.cache/huggingface`;
    const fishLines = [
      `set -gx UV_CACHE_DIR /scratch/${user}/.cache/uv`,
      `set -gx PIP_CACHE_DIR /scratch/${user}/.cache/pip`,
      `set -gx HF_HOME ${hfHome}`,
    ];
    await upsertShellBlock(ssh, "~/.config/fish/config.fish", fishLines);
  }

  return shell;
}

/**
 * Idempotent: remove any existing rv block from rcFile, then append the new one.
 * Uses sed to delete the old block and printf to append the new one.
 * Safe: never overwrites the file — only deletes the marked block and appends.
 */
async function upsertShellBlock(
  ssh: SSHClient,
  rcFile: string,
  lines: string[],
): Promise<void> {
  // Join with literal \n so printf interprets them as newlines
  const block = [BASHRC_MARKER_START, ...lines, BASHRC_MARKER_END].join("\\n");

  // sed -i: remove old block (silently fail if file doesn't exist)
  // printf >>: append new block
  await ssh.exec(
    `sed -i '/${sedEscape(BASHRC_MARKER_START)}/,/${sedEscape(BASHRC_MARKER_END)}/d' ${rcFile} 2>/dev/null || true; ` +
      `printf '\\n${block}\\n' >> ${rcFile}`,
  );
}

/** Escape special chars for sed BRE patterns */
function sedEscape(str: string): string {
  return str.replace(/[[\].*^$/\\]/g, "\\$&");
}

// ═══════════════ Main Flow ═══════════════

async function runInit(options: { force?: boolean }) {
  const existingConfig = loadConfig();

  // ── Check if already fully set up ──
  if (existingConfig && !options.force) {
    const checkSpinner = ora("Checking connection...").start();
    const works = await testKeyAuth(
      existingConfig.connection.hostname,
      existingConfig.connection.user,
    );

    if (works) {
      checkSpinner.succeed("Connected to Rivanna");

      // Ensure remote environment is current (idempotent, fast)
      try {
        const ssh = new SSHClient({ host: existingConfig.connection.host });
        await ensureRemoteSetup(
          ssh,
          existingConfig.connection.user,
          existingConfig.shared?.hf_cache,
        );
      } catch {
        // Non-fatal
      }

      console.log(theme.success("\nrv is already initialized!"));
      console.log(theme.muted(`  User: ${existingConfig.connection.user}`));
      console.log(theme.muted(`  Host: ${existingConfig.connection.host}`));
      console.log(theme.muted("\n  Use --force to re-run setup.\n"));
      return;
    }

    checkSpinner.stop();
    console.log(
      theme.warning("\nFound existing config but cannot connect to Rivanna."),
    );
    console.log(theme.muted("Resuming setup...\n"));
  }

  const isResume = existingConfig != null && !options.force;
  const isForce = existingConfig != null && !!options.force;

  if (!existingConfig) {
    console.log(theme.emphasis("\nWelcome to rv!\n"));
    console.log(
      theme.muted("Let's set up your connection to UVA's Rivanna cluster.\n"),
    );
  }

  // ── Step 1: Computing ID ──
  let user: string;
  if (isResume) {
    user = existingConfig!.connection.user;
    console.log(theme.muted(`  Computing ID: ${user}`));
  } else {
    const computingId = await input({
      message: "UVA Computing ID:",
      default: isForce ? existingConfig!.connection.user : undefined,
      validate: (value) => {
        if (!value.trim()) return "Computing ID is required";
        if (!/^[a-z]{2,3}\d[a-z]{2,3}$/.test(value.trim())) {
          return "Should look like: abs6bd, cm7jk, tqf5qb";
        }
        return true;
      },
    });
    user = computingId.trim().toLowerCase();
  }

  // ── Step 2: Hostname ──
  let hostname: string;
  if (isResume) {
    hostname = existingConfig!.connection.hostname;
    console.log(theme.muted(`  Hostname: ${hostname}\n`));
  } else {
    hostname = await input({
      message: "SSH hostname:",
      default: isForce ? existingConfig!.connection.hostname : DEFAULT_HOSTNAME,
    });
  }

  // ── Step 3: Save config early (resumability) ──
  // If interrupted after this point, rv init will resume with stored values
  const config: RvConfig = {
    connection: { host: SSH_HOST_ALIAS, user, hostname },
    defaults: existingConfig?.defaults ?? {
      account: "mygroup",
      gpu_type: "any",
      time: "2:59:00",
      partition: "gpu",
    },
    paths: { scratch: `/scratch/${user}`, home: `/home/${user}` },
    notifications: existingConfig?.notifications ?? {
      enabled: true,
      email: `${user}@virginia.edu`,
    },
  };
  // Always update connection + paths in case user changed them (--force)
  config.connection = { host: SSH_HOST_ALIAS, user, hostname };
  config.paths = { scratch: `/scratch/${user}`, home: `/home/${user}` };
  saveConfig(config);

  // ── Step 4: VPN / connectivity check ──
  const vpnSpinner = ora("Checking connectivity to Rivanna...").start();
  const reachable = await testConnectivity(`${user}@${hostname}`);
  if (!reachable) {
    vpnSpinner.fail("Cannot reach Rivanna");
    console.log(
      theme.error(
        "\nMake sure you are connected to the UVA VPN (Cisco AnyConnect).",
      ),
    );
    console.log(
      theme.muted(
        "  Download: https://virginia.service-now.com/its?id=itsweb_kb_article&sys_id=f24e5cdfdb3acb804f32fb671d9619d0\n",
      ),
    );
    process.exit(1);
  }
  vpnSpinner.succeed("Rivanna is reachable");

  // ── Step 5: SSH key setup ──
  let keyPath = SSH_KEY_PATH;

  // Check if key auth already works (skip setup if so)
  const authSpinner = ora("Testing SSH authentication...").start();
  const authWorks = await testKeyAuth(hostname, user);

  if (authWorks) {
    // Find which specific key works (for SSH config IdentityFile)
    const existingKeys = findExistingKeys();
    for (const key of existingKeys) {
      if (await testKeyAuth(hostname, user, key.path)) {
        keyPath = key.path;
        break;
      }
    }
    authSpinner.succeed(
      `SSH key authentication works (${keyPath.replace(/.*\//, "")})`,
    );
  } else {
    authSpinner.info("SSH key authentication needs setup");

    const existingKeys = findExistingKeys();
    if (existingKeys.length > 0) {
      const keyChoices = existingKeys.map((k) => ({
        name: `Use existing ${k.name}`,
        value: k.path,
      }));
      keyChoices.push({
        name: "Generate a new ed25519 key",
        value: "__generate__",
      });

      const choice = await select({
        message: "Which SSH key should rv use?",
        choices: keyChoices,
      });

      keyPath = choice === "__generate__" ? await generateSSHKey(user) : choice;
    } else {
      console.log(theme.muted("\nNo SSH keys found. Let's create one.\n"));
      keyPath = await generateSSHKey(user);
    }

    // Copy the chosen key to Rivanna
    await copyKeyToRivanna(keyPath, user, hostname);

    // Verify it works
    const verifySpinner = ora("Verifying SSH key authentication...").start();
    const verified = await testKeyAuth(hostname, user, keyPath);
    if (!verified) {
      verifySpinner.fail("SSH key authentication failed");
      console.log(
        theme.error("\nKey was copied but authentication still fails."),
      );
      console.log(theme.muted("  - Check permissions on ~/.ssh on Rivanna"));
      console.log(theme.muted(`  - Debug: ssh -vv ${user}@${hostname}\n`));
      process.exit(1);
    }
    verifySpinner.succeed("SSH key authentication verified");
  }

  // ── Step 6: SSH config (idempotent) ──
  const configSpinner = ora("Configuring SSH...").start();
  writeSSHConfig(user, hostname, keyPath);
  configSpinner.succeed("SSH config updated (alias: rv-hpc, ControlMaster on)");

  // ── Step 7: Slurm account discovery ──
  const rvSsh = new SSHClient({ host: SSH_HOST_ALIAS });
  let account = config.defaults.account;
  const needsDiscovery = !account || account === "mygroup";

  if (needsDiscovery) {
    const discoverSpinner = ora("Discovering Slurm accounts...").start();
    let allAccounts: { name: string; balance: number }[] = [];

    try {
      const output = await rvSsh.exec("allocations 2>/dev/null || true");
      allAccounts = parseAccountsFromAllocations(output);

      if (allAccounts.length === 1) {
        account = allAccounts[0]!.name;
        discoverSpinner.succeed(
          `Found account: ${account} (${allAccounts[0]!.balance.toLocaleString()} SU available)`,
        );
      } else if (allAccounts.length > 1) {
        discoverSpinner.succeed(`Found ${allAccounts.length} accounts`);
      } else {
        discoverSpinner.warn("No Slurm accounts found");
      }
    } catch {
      discoverSpinner.warn("Could not discover Slurm accounts");
    }

    if (allAccounts.length > 1) {
      account = await select({
        message: "Which Slurm account should rv use?",
        choices: allAccounts.map((a) => ({
          name: `${a.name} (${a.balance.toLocaleString()} SU available)`,
          value: a.name,
        })),
      });
    }

    if (!account || account === "mygroup") {
      account = await input({
        message: "Slurm account (run 'allocations' on Rivanna to find yours):",
        default: "mygroup",
      });
    }
  }

  // ── Step 8: Shared group storage detection ──
  const existingShared = existingConfig?.shared?.hf_cache;
  if (!existingShared) {
    const { dirs: groupDirs, quotas } = await detectGroupStorage(rvSsh);
    if (groupDirs.length > 0) {
      console.log(
        theme.muted(
          `\nDetected shared group storage: ${groupDirs.map((d) => d.path).join(", ")}`,
        ),
      );
      const useShared = await confirm({
        message:
          "Share HuggingFace model cache with your lab group? (saves disk, avoids re-downloading)",
        default: true,
      });

      if (useShared) {
        let groupDir: string;
        if (groupDirs.length === 1) {
          groupDir = groupDirs[0]!.path;
        } else {
          groupDir = await select({
            message: "Which group directory?",
            choices: groupDirs.map((d) => ({
              name: `${d.path} (${d.type})`,
              value: d.path,
            })),
          });
        }

        // Quota check: warn if shared filesystem is >80% full
        const quota = quotas.find((q) => q.mountPoint === groupDir);
        let proceedWithShared = true;

        if (quota && quota.usedPercent > 80) {
          const freeBytes = quota.totalBytes - quota.usedBytes;
          console.log(
            theme.warning(
              `\n  Warning: ${groupDir} is ${quota.usedPercent}% full ` +
                `(${formatBytes(quota.usedBytes)} / ${formatBytes(quota.totalBytes)}, ` +
                `${formatBytes(freeBytes)} free)`,
            ),
          );
          proceedWithShared = await confirm({
            message: "Shared storage is almost full. Proceed anyway?",
            default: false,
          });
        }

        if (proceedWithShared) {
          const sharedHfPath = `${groupDir}/.cache/huggingface`;
          config.shared = { hf_cache: sharedHfPath };

          // Create the shared cache dir (group-writable)
          const mkdirSpinner = ora("Setting up shared model cache...").start();
          try {
            await rvSsh.exec(
              `mkdir -p "${sharedHfPath}" && chmod g+rwxs "${sharedHfPath}" 2>/dev/null || true`,
            );
            mkdirSpinner.succeed(`Shared HF cache: ${sharedHfPath}`);
          } catch {
            mkdirSpinner.warn(
              "Could not create shared cache dir (check group permissions)",
            );
            config.shared = undefined;
          }

          // Migrate existing scratch HF cache → shared
          if (config.shared) {
            const scratchHf = PATHS.cache.hf(user);
            await migrateScratchCache(rvSsh, scratchHf, sharedHfPath, quota);
          }
        }
      }
    }
  }

  // ── Step 9: Save final config ──
  config.defaults.account = account;
  saveConfig(config);
  console.log(theme.success("Config saved to ~/.rv/config.toml"));

  // ── Step 10: Remote environment setup (idempotent) ──
  const setupSpinner = ora("Setting up remote environment...").start();
  try {
    const shell = await ensureRemoteSetup(rvSsh, user, config.shared?.hf_cache);
    setupSpinner.succeed("Remote environment configured");
    if (shell !== "bash") {
      console.log(
        theme.muted(
          `  Note: Your shell is ${shell}. Cache vars added to .bashrc (Slurm) and your shell's rc file.`,
        ),
      );
    }
  } catch {
    setupSpinner.warn("Could not fully set up remote environment (non-fatal)");
  }

  // ── Done! ──
  console.log(theme.success("\nrv is ready to use!"));
  console.log(theme.muted(`  User: ${user}`));
  console.log(theme.muted(`  Host: ${SSH_HOST_ALIAS} (${hostname})`));
  console.log(theme.muted(`  Account: ${account}`));
  console.log(
    theme.muted(
      `  Notifications: ${config.notifications.enabled ? config.notifications.email : "disabled"}`,
    ),
  );
  console.log(theme.muted(`  Config: ~/.rv/config.toml\n`));
  console.log(theme.accent("  Try: rv status\n"));
}
