import type { Subprocess } from "bun";
import { BATCH_DELIMITER } from "@/lib/constants.ts";
import { SSHConnectionError, SSHTimeoutError, VPNError } from "@/lib/errors.ts";

export interface RsyncOptions {
  exclude?: string[];
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
    return new SSHClient({
      host: config.connection.host,
      user: config.connection.user,
    });
  }

  private get target(): string {
    return this.user ? `${this.user}@${this.host}` : this.host;
  }

  async exec(command: string): Promise<string> {
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
    }, this.timeoutMs);

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
    const combined = commands.join(` && echo "${delim}" && `);
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
