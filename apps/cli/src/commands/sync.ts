import type { Command } from "commander";
import { basename, resolve } from "path";
import { watch } from "fs";
import { PATHS } from "@rivanna/shared";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import { DEFAULT_SYNC_EXCLUDES } from "@/lib/constants.ts";
import { getGitInfo, getTrackedFiles } from "@/core/git.ts";

interface SyncPushOptions {
  dryRun?: boolean;
}

export function registerSyncCommand(program: Command) {
  const sync = program.command("sync").description("Sync files with Rivanna");

  sync
    .command("push")
    .description("Push local files to Rivanna")
    .argument("[local]", "local path", ".")
    .argument("[remote]", "remote path")
    .option("--dry-run", "show what would be synced")
    .action(
      async (
        local: string,
        remote: string | undefined,
        options: SyncPushOptions,
      ) => {
        try {
          await runPush(local, remote, options);
        } catch (error) {
          if (error instanceof Error) {
            console.error(theme.error(`\nError: ${error.message}`));
          }
          process.exit(1);
        }
      },
    );

  sync
    .command("pull")
    .description("Pull files from Rivanna")
    .argument("<remote>", "remote path")
    .argument("[local]", "local path", ".")
    .option("--dry-run", "show what would be synced")
    .action(async (remote: string, local: string, options: SyncPushOptions) => {
      try {
        await runPull(remote, local, options);
      } catch (error) {
        if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });

  sync
    .command("watch")
    .description("Watch and push on changes")
    .argument("[local]", "local path", ".")
    .argument("[remote]", "remote path")
    .action(async (local: string, remote: string | undefined) => {
      try {
        await runWatch(local, remote);
      } catch (error) {
        if (error instanceof Error) {
          console.error(theme.error(`\nError: ${error.message}`));
        }
        process.exit(1);
      }
    });
}

function defaultRemote(user: string, localPath: string): string {
  const absPath = resolve(localPath);
  const dirName = basename(absPath);
  const git = getGitInfo(absPath);
  const branch = git ? git.safeBranch : "_default";
  return `${PATHS.workspaces(user)}/${dirName}/${branch}/code`;
}

async function runPush(
  local: string,
  remote: string | undefined,
  options: SyncPushOptions,
) {
  const { config } = ensureSetup();
  const remotePath = remote ?? defaultRemote(config.connection.user, local);
  const localPath = resolve(local) + "/";

  console.log(theme.info(`\nSyncing ${localPath} → ${remotePath}`));

  const { ssh } = ensureSetup();

  // Use git-tracked file list when available (matches rv run behavior).
  // Falls back to .gitignore filter-based rsync for non-git dirs.
  const absLocal = resolve(local);
  const git = getGitInfo(absLocal);
  const trackedFiles = git ? getTrackedFiles(absLocal) : null;

  if (trackedFiles && trackedFiles.length > 0 && !options.dryRun) {
    await ssh.exec(`mkdir -p ${remotePath}`);
    await ssh.rsyncWithFileList(localPath, remotePath, trackedFiles, {
      exclude: DEFAULT_SYNC_EXCLUDES,
      delete: true,
    });
  } else {
    await ssh.rsync(localPath, remotePath, {
      filters: [":- .gitignore", ":- .rvignore"],
      exclude: DEFAULT_SYNC_EXCLUDES,
      dryRun: options.dryRun,
    });
  }

  if (options.dryRun) {
    console.log(theme.muted("\n(dry run — no files were transferred)"));
  } else {
    console.log(theme.success("\nSync complete."));
  }
}

async function runPull(
  remote: string,
  local: string,
  options: SyncPushOptions,
) {
  const localPath = resolve(local);

  console.log(theme.info(`\nPulling ${remote} → ${localPath}`));

  const { ssh } = ensureSetup();
  await ssh.rsyncPull(remote, localPath, {
    dryRun: options.dryRun,
  });

  if (options.dryRun) {
    console.log(theme.muted("\n(dry run — no files were transferred)"));
  } else {
    console.log(theme.success("\nPull complete."));
  }
}

async function runWatch(local: string, remote: string | undefined) {
  const { config, ssh } = ensureSetup();
  const remotePath = remote ?? defaultRemote(config.connection.user, local);
  const localPath = resolve(local);

  console.log(theme.info(`\nWatching ${localPath} → ${remotePath}`));
  console.log(theme.muted("  Press Ctrl+C to stop.\n"));

  // Initial sync
  await ssh.rsync(localPath + "/", remotePath, {
    filters: [":- .gitignore", ":- .rvignore"],
    exclude: DEFAULT_SYNC_EXCLUDES,
  });
  console.log(
    theme.muted(`  [${new Date().toLocaleTimeString()}] Initial sync done.`),
  );

  // Debounced watcher
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;

  const doSync = async () => {
    if (syncing) return;
    syncing = true;
    try {
      await ssh.rsync(localPath + "/", remotePath, {
        filters: [":- .gitignore", ":- .rvignore"],
        exclude: DEFAULT_SYNC_EXCLUDES,
      });
      console.log(
        theme.muted(`  [${new Date().toLocaleTimeString()}] Synced.`),
      );
    } catch (error) {
      console.error(
        theme.error(
          `  Sync error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    syncing = false;
  };

  watch(localPath, { recursive: true }, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSync, 1000);
  });

  // Keep process alive
  await new Promise(() => {});
}
