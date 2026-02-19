import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import ora from "ora";
import { input, confirm } from "@inquirer/prompts";
import type { RvConfig } from "@rivanna/shared";
import { PATHS } from "@rivanna/shared";
import { SSHClient } from "@/core/ssh.ts";
import { saveConfig, loadConfig } from "@/core/config.ts";
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
          console.error(theme.error(`\nSetup failed: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

async function runInit(options: { force?: boolean }) {
  // Check if already initialized
  const existingConfig = loadConfig();
  if (existingConfig && !options.force) {
    console.log(theme.success("rv is already initialized!"));
    console.log(theme.muted(`  User: ${existingConfig.connection.user}`));
    console.log(theme.muted(`  Host: ${existingConfig.connection.host}`));
    console.log(theme.muted("\nUse --force to re-run setup.\n"));
    return;
  }

  console.log(theme.emphasis("\nWelcome to rv!\n"));
  console.log(theme.muted("Let's set up your connection to Rivanna.\n"));

  // Step 1: Ask for computing ID
  const computingId = await input({
    message: "UVA Computing ID:",
    validate: (value) => {
      if (!value.trim()) return "Computing ID is required";
      if (!/^[a-z]{2,3}\d[a-z]{2,3}$/.test(value.trim())) {
        return "Computing ID should look like: abs6bd";
      }
      return true;
    },
  });
  const user = computingId.trim().toLowerCase();

  // Step 2: Ask for hostname
  const hostname = await input({
    message: "SSH hostname:",
    default: DEFAULT_HOSTNAME,
  });

  // Step 3: Check for SSH key
  const keyExists = existsSync(SSH_KEY_PATH);
  if (!keyExists) {
    console.log(theme.warning("\nNo SSH key found at ~/.ssh/id_ed25519"));
    const generate = await confirm({
      message: "Generate a new ed25519 SSH key?",
      default: true,
    });

    if (generate) {
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
    } else {
      console.log(theme.error("An SSH key is required. Aborting."));
      process.exit(1);
    }
  } else {
    console.log(theme.success("\nSSH key found at ~/.ssh/id_ed25519"));
  }

  // Step 4: Copy key to Rivanna
  console.log(
    theme.muted(
      "\nCopying your SSH key to Rivanna...\nYou will be prompted for your UVA password (one time only).\n",
    ),
  );

  const copySsh = new SSHClient({ host: hostname, user });
  const copyExitCode = await copySsh.execInteractive([
    "ssh-copy-id",
    "-i",
    `${SSH_KEY_PATH}.pub`,
    `${user}@${hostname}`,
  ]);

  if (copyExitCode !== 0) {
    console.log(
      theme.error(
        "\nFailed to copy SSH key. Check your password and try again.",
      ),
    );
    process.exit(1);
  }
  console.log(theme.success("SSH key copied successfully!"));

  // Step 5: Test key auth
  const testSpinner = ora("Testing SSH key authentication...").start();
  const testSsh = new SSHClient({ host: hostname, user });
  try {
    const result = await testSsh.exec("echo ok");
    if (result !== "ok") throw new Error("Unexpected response");
    testSpinner.succeed("SSH key authentication working!");
  } catch {
    testSpinner.fail("SSH key auth test failed");
    console.log(theme.error("Could not authenticate with SSH key."));
    process.exit(1);
  }

  // Step 6: Write SSH config with ControlMaster
  const sshConfigBlock = [
    SSH_CONFIG_MARKER_START,
    `Host ${SSH_HOST_ALIAS}`,
    `    HostName ${hostname}`,
    `    User ${user}`,
    `    ControlMaster auto`,
    `    ControlPath ${SSH_SOCKETS_DIR}/${SSH_HOST_ALIAS}-%r@%h-%p`,
    `    ControlPersist 30m`,
    `    ServerAliveInterval 60`,
    `    IdentityFile ${SSH_KEY_PATH}`,
    SSH_CONFIG_MARKER_END,
  ].join("\n");

  const configSpinner = ora("Configuring SSH...").start();

  // Step 7: Create sockets dir
  if (!existsSync(SSH_SOCKETS_DIR)) {
    mkdirSync(SSH_SOCKETS_DIR, { recursive: true, mode: 0o700 });
  }

  // Read existing SSH config, replace or append rv-hpc block
  let sshConfig = "";
  if (existsSync(SSH_CONFIG_PATH)) {
    sshConfig = readFileSync(SSH_CONFIG_PATH, "utf-8");
  }

  // Remove any existing rv-hpc block
  const markerRegex = new RegExp(
    `${escapeRegex(SSH_CONFIG_MARKER_START)}[\\s\\S]*?${escapeRegex(SSH_CONFIG_MARKER_END)}`,
    "g",
  );
  sshConfig = sshConfig.replace(markerRegex, "").trim();

  // Append new block
  sshConfig = sshConfig + "\n\n" + sshConfigBlock + "\n";
  writeFileSync(SSH_CONFIG_PATH, sshConfig, { mode: 0o600 });
  configSpinner.succeed("SSH config updated with ControlMaster");

  // Step 8: Discover remote environment
  const discoverSpinner = ora(
    "Discovering your Rivanna environment...",
  ).start();

  const rvSsh = new SSHClient({ host: SSH_HOST_ALIAS });

  let defaultAccount = "";
  try {
    const results = await rvSsh.execBatch([
      "allocations 2>/dev/null | head -20",
      "echo $HOME",
    ]);

    const allocationsOutput = results[0] ?? "";
    const accountMatch = allocationsOutput.match(/Account:\s+(\S+)/i);
    if (accountMatch?.[1]) {
      defaultAccount = accountMatch[1];
    }

    discoverSpinner.succeed(
      defaultAccount
        ? `Discovered account: ${defaultAccount}`
        : "Environment discovered (no default account found)",
    );
  } catch {
    discoverSpinner.warn("Could not auto-discover environment");
  }

  if (!defaultAccount) {
    defaultAccount = await input({
      message: "Slurm account (allocation group):",
      default: "mygroup",
    });
  }

  // Step 9: Write ~/.rv/config.toml
  const config: RvConfig = {
    connection: {
      host: SSH_HOST_ALIAS,
      user,
      hostname,
    },
    defaults: {
      account: defaultAccount,
      gpu_type: "any",
      time: "2:59:00",
      partition: "gpu",
    },
    paths: {
      scratch: `/scratch/${user}`,
      home: `/home/${user}`,
    },
    notifications: {
      enabled: false,
      email: "",
    },
  };

  saveConfig(config);
  console.log(theme.success("Config written to ~/.rv/config.toml"));

  // Step 10: Set up remote cache directories and .bashrc exports
  const setupSpinner = ora("Setting up remote cache directories...").start();

  try {
    const cacheDirs = [
      PATHS.cache.uv(user),
      PATHS.cache.pip(user),
      PATHS.cache.hf(user),
      PATHS.rvDir(user),
      PATHS.logs(user),
      PATHS.envFiles(user),
    ];

    await rvSsh.exec(`mkdir -p ${cacheDirs.join(" ")}`);

    // Symlink ~/.cache/huggingface → scratch so all tools share one cache
    const hfScratch = PATHS.cache.hf(user);
    await rvSsh.exec(
      `if [ -d ~/.cache/huggingface ] && [ ! -L ~/.cache/huggingface ]; then ` +
        `rsync -a --ignore-existing ~/.cache/huggingface/ ${hfScratch}/ && ` +
        `rm -rf ~/.cache/huggingface && ` +
        `ln -s ${hfScratch} ~/.cache/huggingface; ` +
        `elif [ ! -e ~/.cache/huggingface ]; then ` +
        `mkdir -p ~/.cache && ln -s ${hfScratch} ~/.cache/huggingface; fi`,
    );

    // Add cache env vars to .bashrc (idempotently)
    const bashrcExports = [
      BASHRC_MARKER_START,
      ...CACHE_ENV_EXPORTS(user),
      BASHRC_MARKER_END,
    ].join("\n");

    // Check if marker already exists in .bashrc
    const bashrcCheck = await rvSsh.exec(
      `grep -c '${BASHRC_MARKER_START}' ~/.bashrc 2>/dev/null || echo 0`,
    );

    if (bashrcCheck.trim() === "0") {
      // Use writeFile to append safely (avoids quoting issues)
      const currentBashrc = await rvSsh.exec(
        "cat ~/.bashrc 2>/dev/null || true",
      );
      await rvSsh.writeFile(
        "~/.bashrc",
        currentBashrc + "\n\n" + bashrcExports + "\n",
      );
    }

    setupSpinner.succeed("Remote cache directories and .bashrc configured");
  } catch {
    setupSpinner.warn("Could not set up remote cache directories (non-fatal)");
  }

  // Done!
  console.log(theme.success("\nrv is ready to use!"));
  console.log(theme.muted(`  User: ${user}`));
  console.log(theme.muted(`  Host: ${SSH_HOST_ALIAS} (${hostname})`));
  console.log(theme.muted(`  Account: ${defaultAccount}`));
  console.log(theme.muted(`  Config: ~/.rv/config.toml\n`));
  console.log(theme.accent("  Try: rv status\n"));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
