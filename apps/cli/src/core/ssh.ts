import type { Subprocess } from "bun";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { BATCH_DELIMITER } from "@/lib/constants.ts";
import { SSHConnectionError, SSHTimeoutError, VPNError } from "@/lib/errors.ts";

export interface RsyncOptions {
  exclude?: string[];
  filters?: string[];
  delete?: boolean;
  dryRun?: boolean;
}

export interface SSHClientOptions {
  host: string;
  user?: string;
  timeoutMs?: number;
}

export class SSHClient {
  private host: string;
  private user: string | undefined;
  private timeoutMs: number;

  constructor(options: SSHClientOptions) {
    this.host = options.host;
    this.user = options.user;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  static fromConfig(config: {
    connection: { host: string; user: string };
  }): SSHClient {
    // When host is an SSH alias (e.g., "rv-hpc", "uva-hpc"), the user is
    // already configured in ~/.ssh/config. Don't prepend user@ or SSH will
    // fail with BatchMode=yes if the alias overrides the username.
    return new SSHClient({
      host: config.connection.host,
    });
  }

  private get target(): string {
    return this.user ? `${this.user}@${this.host}` : this.host;
  }

  async exec(
    command: string,
    options?: { timeoutMs?: number },
  ): Promise<string> {
    const args = [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      this.target,
      command,
    ];

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = setTimeout(() => {
      proc.kill();
    }, options?.timeoutMs ?? this.timeoutMs);

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    clearTimeout(timeout);

    if (exitCode !== 0) {
      const errMsg = stderr.trim();
      if (errMsg.includes("Permission denied")) {
        throw new SSHConnectionError(
          'SSH authentication failed. Run "rv init" to set up SSH keys.',
        );
      }
      if (
        errMsg.includes("Could not resolve hostname") ||
        errMsg.includes("Connection refused")
      ) {
        throw new VPNError();
      }
      if (errMsg.includes("Connection timed out")) {
        throw new SSHTimeoutError(
          "SSH connection timed out. Check VPN connection.",
        );
      }
      throw new SSHConnectionError(
        `SSH command failed (exit ${exitCode}): ${errMsg || stdout.trim()}`,
      );
    }

    return stdout.trim();
  }

  async execBatch(commands: string[], delimiter?: string): Promise<string[]> {
    const delim = delimiter ?? BATCH_DELIMITER;
    const combined = commands.join(` ; echo "${delim}" ; `);
    const output = await this.exec(combined);
    return output.split(delim).map((s) => s.trim());
  }

  async writeFile(remotePath: string, content: string): Promise<void> {
    const args = [
      "ssh",
      "-o",
      "BatchMode=yes",
      this.target,
      `cat > ${remotePath}`,
    ];

    const proc = Bun.spawn(args, {
      stdin: new Blob([content]),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      throw new SSHConnectionError(
        `Failed to write ${remotePath}: ${stderr.trim()}`,
      );
    }
  }

  async rsync(
    localPath: string,
    remotePath: string,
    options?: RsyncOptions,
  ): Promise<void> {
    const args = ["rsync", "-avz", "--progress", "-e", "ssh -o BatchMode=yes"];

    if (options?.delete) args.push("--delete");
    if (options?.dryRun) args.push("--dry-run");
    if (options?.filters) {
      for (const filter of options.filters) {
        args.push("--filter", filter);
      }
    }
    if (options?.exclude) {
      for (const pattern of options.exclude) {
        args.push("--exclude", pattern);
      }
    }

    args.push(localPath, `${this.target}:${remotePath}`);

    const proc = Bun.spawn(args, {
      stdio: ["inherit", "inherit", "inherit"],
    });
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new SSHConnectionError(`rsync failed with exit code ${exitCode}`);
    }
  }

  async rsyncWithFileList(
    localPath: string,
    remotePath: string,
    files: string[],
    options?: RsyncOptions,
  ): Promise<void> {
    const tmpFile = join(
      tmpdir(),
      `rv-filelist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    writeFileSync(tmpFile, files.join("\n") + "\n");

    try {
      const args = [
        "rsync",
        "-avz",
        "--progress",
        "-e",
        "ssh -o BatchMode=yes",
        `--files-from=${tmpFile}`,
      ];

      if (options?.delete) args.push("--delete");
      if (options?.dryRun) args.push("--dry-run");
      if (options?.exclude) {
        for (const pattern of options.exclude) {
          args.push("--exclude", pattern);
        }
      }

      args.push(localPath, `${this.target}:${remotePath}`);

      const proc = Bun.spawn(args, {
        stdio: ["inherit", "inherit", "inherit"],
      });
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        throw new SSHConnectionError(`rsync failed with exit code ${exitCode}`);
      }
    } finally {
      try {
        unlinkSync(tmpFile);
      } catch {}
    }
  }

  async rsyncPull(
    remotePath: string,
    localPath: string,
    options?: RsyncOptions,
  ): Promise<void> {
    const args = ["rsync", "-avz", "--progress", "-e", "ssh -o BatchMode=yes"];

    if (options?.delete) args.push("--delete");
    if (options?.dryRun) args.push("--dry-run");
    if (options?.filters) {
      for (const filter of options.filters) {
        args.push("--filter", filter);
      }
    }
    if (options?.exclude) {
      for (const pattern of options.exclude) {
        args.push("--exclude", pattern);
      }
    }

    args.push(`${this.target}:${remotePath}`, localPath);

    const proc = Bun.spawn(args, {
      stdio: ["inherit", "inherit", "inherit"],
    });
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new SSHConnectionError(
        `rsync pull failed with exit code ${exitCode}`,
      );
    }
  }

  tunnel(
    localPort: number,
    remoteHost: string,
    remotePort: number,
  ): Subprocess {
    return Bun.spawn(
      [
        "ssh",
        "-N",
        "-L",
        `${localPort}:${remoteHost}:${remotePort}`,
        this.target,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
  }

  async isConnected(): Promise<boolean> {
    try {
      const result = await this.exec("echo ok");
      return result === "ok";
    } catch {
      return false;
    }
  }

  async execInteractive(args: string[]): Promise<number> {
    const proc = Bun.spawn(args, {
      stdio: ["inherit", "inherit", "inherit"],
    });
    return proc.exited;
  }
}
