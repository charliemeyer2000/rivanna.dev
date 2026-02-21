import { execSync } from "child_process";

export interface GitInfo {
  branch: string;
  safeBranch: string;
  commitHash: string;
  dirty: boolean;
}

/**
 * Sanitize a branch name for use as a directory name.
 * Replaces `/` with `--`, strips unsafe chars, truncates to 80 chars.
 */
export function sanitizeBranch(branch: string): string {
  return branch
    .replace(/\//g, "--")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/**
 * Get git info for a project root. Returns null if not a git repo.
 */
export function getGitInfo(projectRoot: string): GitInfo | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const commitHash = execSync("git rev-parse --short HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const status = execSync("git status --porcelain", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const dirty = status.length > 0;

    // Detached HEAD: git returns "HEAD" for --abbrev-ref
    const resolvedBranch =
      branch === "HEAD" ? `detached-${commitHash}` : branch;

    return {
      branch: resolvedBranch,
      safeBranch: sanitizeBranch(resolvedBranch),
      commitHash,
      dirty,
    };
  } catch {
    return null;
  }
}

/**
 * Get list of git-tracked files (cached + untracked non-ignored).
 * Returns paths relative to project root.
 */
export function getTrackedFiles(projectRoot: string): string[] | null {
  try {
    const output = execSync(
      "git ls-files --cached --others --exclude-standard",
      {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
      },
    ).trim();

    if (!output) return [];
    return output.split("\n");
  } catch {
    return null;
  }
}
