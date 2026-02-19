import type { Command } from "commander";
import ora from "ora";
import { confirm } from "@inquirer/prompts";
import { theme } from "@/lib/theme.ts";
import { SITE_URL } from "@/lib/constants.ts";
import {
  fetchLatestVersion,
  compareVersions,
  getCurrentVersion,
} from "@/lib/version-check.ts";

export function registerUpgradeCommand(program: Command) {
  program
    .command("upgrade")
    .description("Upgrade rv to the latest version")
    .action(async () => {
      try {
        await runUpgrade();
      } catch (error) {
        if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

async function runUpgrade() {
  const currentVersion = getCurrentVersion();
  const spinner = ora("Checking for updates...").start();

  const latest = await fetchLatestVersion();
  if (!latest) {
    spinner.fail(theme.error("Failed to check for updates"));
    console.log(theme.muted("\nPlease try again later."));
    process.exit(1);
  }

  if (!compareVersions(currentVersion, latest)) {
    spinner.succeed(
      theme.success("Already on the latest version!") +
        " " +
        theme.muted(`(${currentVersion})`),
    );
    return;
  }

  spinner.succeed(
    theme.emphasis("Update available: ") +
      theme.muted(currentVersion) +
      " → " +
      theme.success(latest),
  );

  console.log();
  const shouldUpgrade = await confirm({
    message: "Upgrade now?",
    default: true,
  });

  if (!shouldUpgrade) {
    console.log(theme.muted("\nUpgrade cancelled."));
    return;
  }

  console.log();
  const upgradeSpinner = ora("Downloading and installing update...").start();

  try {
    const installUrl = `${SITE_URL}/install.sh`;
    const proc = Bun.spawn(["bash", "-c", `curl -fsSL ${installUrl} | bash`], {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    if (proc.exitCode === 0) {
      upgradeSpinner.succeed(
        theme.success(`Successfully upgraded to v${latest}!`),
      );
    } else {
      const stderr = await new Response(proc.stderr).text();

      if (stderr.includes("Permission denied") || stderr.includes("EACCES")) {
        upgradeSpinner.fail(theme.error("Permission denied"));
        console.log(
          theme.muted("\nTry: ") +
            theme.accent(`curl -fsSL ${SITE_URL}/install.sh | sudo bash`),
        );
      } else {
        upgradeSpinner.fail(theme.error("Upgrade failed"));
        console.log(
          theme.muted("\nManual install: ") +
            theme.accent(`curl -fsSL ${SITE_URL}/install.sh | bash`),
        );
      }
      process.exit(1);
    }
  } catch {
    upgradeSpinner.fail(theme.error("Upgrade failed"));
    console.log(
      theme.muted("\nManual install: ") +
        theme.accent(`curl -fsSL ${SITE_URL}/install.sh | bash`),
    );
    process.exit(1);
  }
}
