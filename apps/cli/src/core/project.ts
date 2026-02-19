import { existsSync, readFileSync } from "fs";
import { resolve, dirname, basename, relative, extname } from "path";
import { createHash } from "crypto";
import type { SSHClient } from "./ssh.ts";
import { PATHS } from "@rivanna/shared";
import { DEFAULT_SYNC_EXCLUDES, DEFAULT_MODULES } from "@/lib/constants.ts";
import type { Ora } from "ora";

// --------------- Types ---------------

interface ProjectInfo {
  name: string;
  localRoot: string;
  remotePath: string;
  venvPath: string;
  entrypoint: string;
  depsFile: string | null;
  depsHash: string | null;
}

export interface ExecutionResult {
  command: string;
  workDir: string;
  venvPath: string | null;
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
 */
function buildProjectInfo(localFilePath: string, user: string): ProjectInfo {
  const projectRoot = findProjectRoot(localFilePath);
  const projectName = basename(projectRoot);
  const entrypoint = relative(projectRoot, localFilePath);
  const depsFileName = findDepsFile(projectRoot);
  const depsHash = depsFileName
    ? hashFile(resolve(projectRoot, depsFileName))
    : null;

  return {
    name: projectName,
    localRoot: projectRoot,
    remotePath: `${PATHS.workspaces(user)}/${projectName}`,
    venvPath: `${PATHS.envs(user)}/${projectName}`,
    entrypoint,
    depsFile: depsFileName,
    depsHash,
  };
}

// --------------- Remote Operations ---------------

/**
 * Sync the project to the remote workspace via rsync.
 */
async function syncProject(
  ssh: SSHClient,
  project: ProjectInfo,
): Promise<void> {
  await ssh.exec(`mkdir -p ${project.remotePath}`);
  await ssh.rsync(project.localRoot + "/", project.remotePath, {
    filters: [":- .gitignore", ":- .rvignore"],
    exclude: DEFAULT_SYNC_EXCLUDES,
    delete: true,
  });
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
 * Installs deps with --only-binary :all: for fast, reliable installs.
 */
async function ensureVenv(ssh: SSHClient, project: ProjectInfo): Promise<void> {
  if (!project.depsFile || !project.depsHash) return;

  const uvBin = "~/.local/bin/uv";
  const moduleLoad = `module load ${DEFAULT_MODULES.join(" ")}`;
  const depsRemotePath = `${project.remotePath}/${project.depsFile}`;
  const uvEnv = "UV_LINK_MODE=copy";

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

  // Install deps (long timeout — large packages like vllm can be 350MB+)
  const installCmd =
    project.depsFile === "requirements.txt"
      ? `${uvBin} pip install --only-binary :all: -r ${depsRemotePath} --python ${project.venvPath}/bin/python`
      : `${uvBin} pip install --only-binary :all: -e ${project.remotePath} --python ${project.venvPath}/bin/python`;

  await ssh.exec(`${moduleLoad} && ${uvEnv} ${installCmd}`, {
    timeoutMs: 300_000,
  });

  // Write deps hash
  await ssh.writeFile(`${project.venvPath}/.deps-hash`, project.depsHash);
}

/**
 * Build the remote command string from an entrypoint and extra args.
 */
function buildRemoteCommand(entrypoint: string, args: string[]): string {
  const ext = extname(entrypoint).toLowerCase();
  const argsStr = args.length > 0 ? " " + args.join(" ") : "";

  if (ext === ".py") return `python ${entrypoint}${argsStr}`;
  if (ext === ".sh" || ext === ".bash") return `bash ${entrypoint}${argsStr}`;
  return `./${entrypoint}${argsStr}`;
}

// --------------- Public Pipeline ---------------

/**
 * Full smart execution pipeline: detect → sync → deps → rewrite.
 *
 * If the first arg is a local file, syncs the project, ensures deps,
 * and returns a rewritten command for the Slurm script.
 * Returns null if the arg is a raw command (no local file detected).
 */
export async function prepareExecution(
  commandArgs: string[],
  user: string,
  ssh: SSHClient,
  spinner?: Ora,
): Promise<ExecutionResult | null> {
  const firstArg = commandArgs[0];
  if (!firstArg) return null;

  const localFile = detectLocalFile(firstArg);
  if (!localFile) return null;

  const project = buildProjectInfo(localFile, user);
  const remainingArgs = commandArgs.slice(1);

  // Sync project
  if (spinner) spinner.text = `Syncing ${project.name}...`;
  await syncProject(ssh, project);

  // Ensure deps
  let venvPath: string | null = null;
  if (project.depsFile) {
    const current = await isVenvCurrent(ssh, project);
    if (!current) {
      if (spinner)
        spinner.text = `Installing dependencies (${project.depsFile})...`;
      await ensureVenv(ssh, project);
    }
    venvPath = project.venvPath;
  }

  const command = buildRemoteCommand(project.entrypoint, remainingArgs);

  return {
    command,
    workDir: project.remotePath,
    venvPath,
  };
}
