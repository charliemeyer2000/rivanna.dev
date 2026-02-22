import { existsSync, readFileSync } from "fs";
import { resolve, dirname, basename, relative, extname } from "path";
import { createHash } from "crypto";
import type { SSHClient } from "./ssh.ts";
import { PATHS } from "@rivanna/shared";
import { shellQuote, shellJoin } from "@/lib/shell-quote.ts";
import { DEFAULT_SYNC_EXCLUDES, DEFAULT_MODULES } from "@/lib/constants.ts";
import { getGitInfo, getTrackedFiles, type GitInfo } from "./git.ts";
import type { Ora } from "ora";

// --------------- Types ---------------

interface ProjectInfo {
  name: string;
  localRoot: string;
  remotePath: string; // {project}/{safeBranch}/code
  snapshotsDir: string; // {project}/{safeBranch}/snapshots
  venvPath: string;
  entrypoint: string;
  depsFile: string | null;
  depsHash: string | null;
  git: GitInfo | null;
  trackedFiles: string[] | null;
}

export interface ExecutionResult {
  command: string;
  workDir: string; // snapshot path (immutable, what sbatch runs from)
  codeDir: string; // mutable code/ dir (for display)
  venvPath: string | null;
  localFilePath: string | null;
  git: GitInfo | null;
  depsFile: string | null;
}

// --------------- Constants ---------------

const RUNNABLE_EXTENSIONS = new Set([".py", ".sh", ".bash"]);

const PROJECT_MARKERS = [
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "setup.cfg",
  ".git",
];

const DEPS_FILES = ["requirements.txt", "pyproject.toml"];

const SNAPSHOT_MAX_AGE_DAYS = 7;

// --------------- Detection ---------------

/**
 * Check if the first argument refers to a local file with a runnable extension.
 * Returns the resolved absolute path if it does, null otherwise.
 */
export function detectLocalFile(arg: string): string | null {
  const resolved = resolve(arg);
  if (!existsSync(resolved)) return null;
  const ext = extname(resolved).toLowerCase();
  if (!RUNNABLE_EXTENSIONS.has(ext)) return null;
  return resolved;
}

/**
 * Walk up from a file path to find the project root.
 * Looks for pyproject.toml, requirements.txt, setup.py, .git, etc.
 * Falls back to the file's own directory.
 */
export function findProjectRoot(filePath: string): string {
  let dir = dirname(resolve(filePath));
  const startDir = dir;

  while (dir !== dirname(dir)) {
    for (const marker of PROJECT_MARKERS) {
      if (existsSync(resolve(dir, marker))) {
        return dir;
      }
    }
    dir = dirname(dir);
  }

  return startDir;
}

/**
 * Find a deps file (requirements.txt or pyproject.toml) in the project root.
 */
function findDepsFile(projectRoot: string): string | null {
  for (const name of DEPS_FILES) {
    if (existsSync(resolve(projectRoot, name))) return name;
  }
  return null;
}

/**
 * Compute SHA-256 hash of a file's contents.
 */
function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Build a ProjectInfo object from a detected local file.
 * Now branch-aware: uses git info to construct per-branch paths.
 */
function buildProjectInfo(localFilePath: string, user: string): ProjectInfo {
  const projectRoot = findProjectRoot(localFilePath);
  const projectName = basename(projectRoot);
  const entrypoint = relative(projectRoot, localFilePath);
  const depsFileName = findDepsFile(projectRoot);
  const depsHash = depsFileName
    ? hashFile(resolve(projectRoot, depsFileName))
    : null;

  const git = getGitInfo(projectRoot);
  const branchDir = git ? git.safeBranch : "_default";
  const trackedFiles = git ? getTrackedFiles(projectRoot) : null;

  const workspacesBase = PATHS.workspaces(user);
  const envsBase = PATHS.envs(user);

  return {
    name: projectName,
    localRoot: projectRoot,
    remotePath: `${workspacesBase}/${projectName}/${branchDir}/code`,
    snapshotsDir: `${workspacesBase}/${projectName}/${branchDir}/snapshots`,
    venvPath: `${envsBase}/${projectName}/${branchDir}`,
    entrypoint,
    depsFile: depsFileName,
    depsHash,
    git,
    trackedFiles,
  };
}

// --------------- Remote Operations ---------------

/**
 * Sync the project to the remote workspace via rsync.
 * Uses git-tracked file list when available, falls back to .gitignore filter.
 */
async function syncProject(
  ssh: SSHClient,
  project: ProjectInfo,
): Promise<void> {
  await ssh.exec(`mkdir -p ${project.remotePath}`);

  if (project.trackedFiles && project.trackedFiles.length > 0) {
    await ssh.rsyncWithFileList(
      project.localRoot + "/",
      project.remotePath,
      project.trackedFiles,
      { exclude: DEFAULT_SYNC_EXCLUDES, delete: true },
    );
  } else {
    await ssh.rsync(project.localRoot + "/", project.remotePath, {
      filters: [":- .gitignore", ":- .rvignore"],
      exclude: DEFAULT_SYNC_EXCLUDES,
      delete: true,
    });
  }
}

/**
 * Check if the remote venv exists and has a matching deps hash.
 */
async function isVenvCurrent(
  ssh: SSHClient,
  project: ProjectInfo,
): Promise<boolean> {
  if (!project.depsHash) return false;
  const hashPath = `${project.venvPath}/.deps-hash`;
  try {
    const remoteHash = await ssh.exec(`cat ${hashPath} 2>/dev/null || echo ""`);
    return remoteHash.trim() === project.depsHash;
  } catch {
    return false;
  }
}

/**
 * Create or update the remote venv using uv.
 *
 * Two-phase install strategy:
 *   Phase 1 (here, login node): Install all deps. If the install fails
 *     (e.g. flash-attn needs GPU/gcc for compilation), fall back to
 *     --only-binary :all: to install everything available as wheels,
 *     then write a `.needs-phase2` marker so the sbatch preamble can
 *     finish the install on the compute node where GPU + gcc are available.
 *   Phase 2 (sbatch preamble, base.ts): If `.needs-phase2` exists,
 *     re-run the install with --no-build-isolation + gcc. uv skips
 *     already-installed packages and only builds the missing ones.
 */
async function ensureVenv(
  ssh: SSHClient,
  project: ProjectInfo,
  user: string,
): Promise<void> {
  if (!project.depsFile || !project.depsHash) return;

  const uvBin = "~/.local/bin/uv";
  const moduleLoad = `module load ${DEFAULT_MODULES.join(" ")}`;
  const depsRemotePath = `${project.remotePath}/${project.depsFile}`;
  const uvCacheDir = PATHS.cache.uv(user);
  const wheelsDir = PATHS.wheels(user);
  const uvEnv = `UV_LINK_MODE=copy UV_CACHE_DIR=${uvCacheDir}`;

  // Check uv availability
  const uvCheck = await ssh.exec(
    `${uvBin} --version 2>/dev/null || echo "NOT_FOUND"`,
  );
  if (uvCheck.includes("NOT_FOUND")) {
    throw new Error(
      `uv is not installed on the cluster. Run: rv exec "curl -LsSf https://astral.sh/uv/install.sh | sh"`,
    );
  }

  // Create venv with module-loaded Python (not system Python)
  await ssh.exec(
    `${moduleLoad} && ${uvEnv} ${uvBin} venv ${project.venvPath} --python $(which python3) --seed 2>/dev/null || true`,
    { timeoutMs: 60_000 },
  );

  // Build install command — check local wheel cache first via --find-links
  const findLinks = `--find-links ${wheelsDir}`;
  const installCmd =
    project.depsFile === "requirements.txt"
      ? `${uvBin} pip install -r ${depsRemotePath} ${findLinks} --python ${project.venvPath}/bin/python`
      : `${uvBin} pip install -e ${project.remotePath} ${findLinks} --python ${project.venvPath}/bin/python`;

  // Phase 1: try full install on login node
  const fullInstall = await ssh.exec(
    `${moduleLoad} && ${uvEnv} ${installCmd} 2>&1; echo "EXIT:$?"`,
    { timeoutMs: 300_000 },
  );
  const exitMatch = fullInstall.match(/EXIT:(\d+)/);
  const exitCode = exitMatch ? parseInt(exitMatch[1]!, 10) : 1;

  if (exitCode === 0) {
    // Full install succeeded — no Phase 2 needed
    await ssh.exec(`rm -f ${project.venvPath}/.needs-phase2`);
    await ssh.writeFile(`${project.venvPath}/.deps-hash`, project.depsHash!);
    return;
  }

  // Full install failed (CUDA packages, old gcc, etc.)
  // Fallback: install packages individually, skipping those that need source builds.
  // --only-binary :all: on the full requirements fails atomically, so we iterate
  // over each line and let the ones with wheels succeed while CUDA-only ones fail.
  if (project.depsFile === "requirements.txt") {
    const perPkgFallback = [
      `while IFS= read -r _line || [ -n "$_line" ]; do`,
      `_line=$(echo "$_line" | sed 's/#.*//' | xargs);`,
      `[ -z "$_line" ] && continue;`,
      `${uvBin} pip install ${findLinks} --python ${project.venvPath}/bin/python "$_line" 2>&1 || true;`,
      `done < ${depsRemotePath}`,
    ].join(" ");
    await ssh.exec(
      `${moduleLoad} && export UV_LINK_MODE=copy UV_CACHE_DIR=${uvCacheDir} && ${perPkgFallback}`,
      { timeoutMs: 300_000 },
    );
  } else {
    // pyproject.toml — best-effort with --only-binary :all:
    const fallbackCmd = `${uvBin} pip install --only-binary :all: -e ${project.remotePath} ${findLinks} --python ${project.venvPath}/bin/python`;
    await ssh.exec(`${moduleLoad} && ${uvEnv} ${fallbackCmd} 2>&1 || true`, {
      timeoutMs: 300_000,
    });
  }

  // Pre-install standard build toolchain so Phase 2 can use --no-build-isolation.
  // These are the universal build deps for compiled Python packages (especially
  // CUDA extensions like flash-attn, auto-gptq, xformers). Installs from
  // cached wheels in <1s.
  await ssh.exec(
    `${moduleLoad} && export UV_LINK_MODE=copy UV_CACHE_DIR=${uvCacheDir} && ${uvBin} pip install --python ${project.venvPath}/bin/python setuptools wheel ninja psutil packaging 2>&1 || true`,
    { timeoutMs: 60_000 },
  );

  // Mark for Phase 2 on compute node
  await ssh.writeFile(`${project.venvPath}/.needs-phase2`, "1");
  await ssh.writeFile(`${project.venvPath}/.deps-hash`, project.depsHash!);
}

/**
 * Create a hardlink snapshot of the code/ directory for a specific job.
 * `cp -al` is instant and uses zero extra disk until files diverge.
 */
async function createSnapshot(
  ssh: SSHClient,
  project: ProjectInfo,
  jobName: string,
): Promise<string> {
  const snapshotPath = `${project.snapshotsDir}/${jobName}-${Date.now()}`;
  await ssh.exec(
    `mkdir -p ${project.snapshotsDir} && cp -al ${project.remotePath}/ ${snapshotPath}`,
  );
  return snapshotPath;
}

/**
 * Remove snapshot directories older than SNAPSHOT_MAX_AGE_DAYS.
 * Non-fatal on error — cleanup is best-effort.
 */
async function pruneSnapshots(
  ssh: SSHClient,
  snapshotsDir: string,
): Promise<void> {
  try {
    await ssh.exec(
      `find ${snapshotsDir} -maxdepth 1 -mindepth 1 -type d -mtime +${SNAPSHOT_MAX_AGE_DAYS} -exec rm -rf {} + 2>/dev/null || true`,
    );
  } catch {
    // Non-fatal
  }
}

/**
 * Build the remote command string from an entrypoint and extra args.
 */
function buildRemoteCommand(entrypoint: string, args: string[]): string {
  const ext = extname(entrypoint).toLowerCase();
  const quotedEntry = shellQuote(entrypoint);
  const argsStr = args.length > 0 ? " " + shellJoin(args) : "";

  if (ext === ".py") return `python ${quotedEntry}${argsStr}`;
  if (ext === ".sh" || ext === ".bash") return `bash ${quotedEntry}${argsStr}`;
  return `./${quotedEntry}${argsStr}`;
}

// --------------- Public Pipeline ---------------

/**
 * Full smart execution pipeline: detect → sync → deps → snapshot → rewrite.
 *
 * Scans all args for a local file (supporting launchers like torchrun,
 * accelerate, deepspeed). If found, syncs the project to a branch-aware
 * code/ directory, ensures deps, creates a hardlink snapshot, and returns
 * a rewritten command for the Slurm script.
 * Returns null if no local files are detected in any argument.
 */
export async function prepareExecution(
  commandArgs: string[],
  user: string,
  ssh: SSHClient,
  jobName: string,
  spinner?: Ora,
): Promise<ExecutionResult | null> {
  if (commandArgs.length === 0) return null;

  // Find the first arg that is a local file (skip flags starting with -)
  let fileArgIndex = -1;
  let localFile: string | null = null;
  for (let i = 0; i < commandArgs.length; i++) {
    const arg = commandArgs[i]!;
    if (arg.startsWith("-")) continue;
    const detected = detectLocalFile(arg);
    if (detected) {
      fileArgIndex = i;
      localFile = detected;
      break;
    }
  }

  // If no file detected in args, fall back to CWD-based project detection.
  // This handles shell-string commands like "uv sync && uv run python ..."
  // where no individual arg resolves to a local file.
  if (!localFile || fileArgIndex < 0) {
    return prepareCwdExecution(commandArgs, user, ssh, jobName, spinner);
  }

  const project = buildProjectInfo(localFile, user);

  // Sync project to code/ directory
  if (spinner) spinner.text = `Syncing ${project.name}...`;
  await syncProject(ssh, project);

  // Ensure deps
  let venvPath: string | null = null;
  if (project.depsFile) {
    const current = await isVenvCurrent(ssh, project);
    if (!current) {
      if (spinner)
        spinner.text = `Installing dependencies (${project.depsFile})...`;
      await ensureVenv(ssh, project, user);
    }
    venvPath = project.venvPath;
  }

  // Prune old snapshots, then create a new one
  if (spinner) spinner.text = "Creating snapshot...";
  await pruneSnapshots(ssh, project.snapshotsDir);
  const snapshotPath = await createSnapshot(ssh, project, jobName);

  // Rebuild command: keep prefix args (launcher + flags), replace file path
  // with relative entrypoint, keep trailing args
  const prefix = commandArgs.slice(0, fileArgIndex);
  const trailing = commandArgs.slice(fileArgIndex + 1);
  const trailingStr = trailing.length > 0 ? " " + shellJoin(trailing) : "";

  // If there's a launcher prefix (torchrun, accelerate, etc.), use the
  // entrypoint path directly — the launcher invokes Python itself.
  // Only add `python` prefix when the file is the first arg.
  const command =
    prefix.length > 0
      ? `${shellJoin(prefix)} ${shellQuote(project.entrypoint)}${trailingStr ? " " + trailingStr : ""}`
      : buildRemoteCommand(project.entrypoint, trailing);

  return {
    command,
    workDir: snapshotPath,
    codeDir: project.remotePath,
    venvPath,
    localFilePath: localFile,
    git: project.git,
    depsFile: project.depsFile,
  };
}

/**
 * Fallback when no local file is detected in args (e.g. shell-string commands
 * like "uv sync && uv run python scripts/compute_vector.py").
 * If CWD is a project directory, sync it and set workDir so the job
 * runs from the workspace — not $HOME.
 */
async function prepareCwdExecution(
  commandArgs: string[],
  user: string,
  ssh: SSHClient,
  jobName: string,
  spinner?: Ora,
): Promise<ExecutionResult | null> {
  const cwd = process.cwd();

  // Only sync if CWD looks like a project
  const hasMarker = PROJECT_MARKERS.some((m) => existsSync(resolve(cwd, m)));
  if (!hasMarker) return null;

  const projectName = basename(cwd);
  const depsFileName = findDepsFile(cwd);
  const depsHash = depsFileName ? hashFile(resolve(cwd, depsFileName)) : null;

  const git = getGitInfo(cwd);
  const branchDir = git ? git.safeBranch : "_default";
  const trackedFiles = git ? getTrackedFiles(cwd) : null;

  const workspacesBase = PATHS.workspaces(user);
  const envsBase = PATHS.envs(user);

  const project: ProjectInfo = {
    name: projectName,
    localRoot: cwd,
    remotePath: `${workspacesBase}/${projectName}/${branchDir}/code`,
    snapshotsDir: `${workspacesBase}/${projectName}/${branchDir}/snapshots`,
    venvPath: `${envsBase}/${projectName}/${branchDir}`,
    entrypoint: "",
    depsFile: depsFileName,
    depsHash,
    git,
    trackedFiles,
  };

  // Sync project to code/ directory
  if (spinner) spinner.text = `Syncing ${project.name}...`;
  await syncProject(ssh, project);

  // Ensure deps
  let venvPath: string | null = null;
  if (project.depsFile) {
    const current = await isVenvCurrent(ssh, project);
    if (!current) {
      if (spinner)
        spinner.text = `Installing dependencies (${project.depsFile})...`;
      await ensureVenv(ssh, project, user);
    }
    venvPath = project.venvPath;
  }

  // Prune old snapshots, then create a new one
  if (spinner) spinner.text = "Creating snapshot...";
  await pruneSnapshots(ssh, project.snapshotsDir);
  const snapshotPath = await createSnapshot(ssh, project, jobName);

  // Pass through command as-is (no rewriting)
  const rawCommand =
    commandArgs.length === 1 ? commandArgs[0]! : shellJoin(commandArgs);

  return {
    command: rawCommand,
    workDir: snapshotPath,
    codeDir: project.remotePath,
    venvPath,
    localFilePath: null,
    git: project.git,
    depsFile: project.depsFile,
  };
}
