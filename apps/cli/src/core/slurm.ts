import type {
  NodeState,
  Job,
  JobAccounting,
  StorageQuota,
  SUBalance,
  SystemState,
  SbatchOptions,
  TestOnlyResult,
} from "@rivanna/shared";
import { PATHS } from "@rivanna/shared";
import { SSHClient } from "./ssh.ts";
import { parseSinfo } from "@/parsers/sinfo.ts";
import { parseSqueue } from "@/parsers/squeue.ts";
import { parseSshare } from "@/parsers/sshare.ts";
import { parseSacct } from "@/parsers/sacct.ts";
import { parseHdquota } from "@/parsers/hdquota.ts";
import { parseAllocations } from "@/parsers/allocations.ts";
import { SINFO_FORMAT, SQUEUE_FORMAT, SACCT_FORMAT } from "@/lib/constants.ts";

export class SlurmClient {
  private ssh: SSHClient;
  private user: string;
  private account: string;

  constructor(ssh: SSHClient, user: string, account: string) {
    this.ssh = ssh;
    this.user = user;
    this.account = account;
  }

  get sshClient(): SSHClient {
    return this.ssh;
  }

  get username(): string {
    return this.user;
  }

  get accountName(): string {
    return this.account;
  }

  // --- Query methods ---

  async getNodeState(partitions?: string[]): Promise<NodeState[]> {
    const partitionArg = partitions
      ? `-p ${partitions.join(",")}`
      : "-p gpu,gpu-mig,interactive-rtx3090,gpu-a6000,gpu-a40,gpu-a100-40,gpu-a100-80,gpu-v100,gpu-h200";
    const output = await this.ssh.exec(
      `sinfo --Node ${partitionArg} -o "${SINFO_FORMAT}" --noheader`,
    );
    return parseSinfo(output);
  }

  async getJobs(user?: string): Promise<Job[]> {
    const userArg = user ? `-u ${user}` : `-u ${this.user}`;
    const output = await this.ssh.exec(
      `squeue --all ${userArg} -o "${SQUEUE_FORMAT}" --noheader`,
    );
    return parseSqueue(output);
  }

  async getFairshare(user?: string): Promise<number> {
    const u = user ?? this.user;
    const output = await this.ssh.exec(`sshare -u ${u} -l`);
    return parseSshare(output);
  }

  async getStorageQuota(): Promise<StorageQuota[]> {
    const output = await this.ssh.exec("hdquota 2>/dev/null || true");
    return parseHdquota(output);
  }

  async getSUBalance(): Promise<SUBalance> {
    const output = await this.ssh.exec("allocations 2>/dev/null || true");
    return parseAllocations(output);
  }

  async getJobHistory(startDate?: string): Promise<JobAccounting[]> {
    const startArg = startDate ? `-S ${startDate}` : "-S now-7days";
    const output = await this.ssh.exec(
      `sacct --parsable2 -n -o ${SACCT_FORMAT} -u ${this.user} ${startArg}`,
    );
    return parseSacct(output);
  }

  // --- Action methods ---

  async submitJob(script: string): Promise<string> {
    const tmpPath = `${PATHS.rvDir(this.user)}/tmp-${Date.now()}.sh`;
    await this.ssh.writeFile(tmpPath, script);
    const output = await this.ssh.exec(
      `chmod +x ${tmpPath} && sbatch ${tmpPath} && rm -f ${tmpPath}`,
    );

    // Parse: "Submitted batch job 12345678"
    const match = output.match(/Submitted batch job (\d+)/);
    if (!match) {
      throw new Error(`Unexpected sbatch output: ${output}`);
    }
    return match[1]!;
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.ssh.exec(`scancel ${jobId}`);
  }

  async cancelJobs(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    await this.ssh.exec(`scancel ${jobIds.join(" ")}`);
  }

  async testOnly(options: SbatchOptions): Promise<TestOnlyResult> {
    const args = [
      `--partition=${options.partition}`,
      `--gres=${options.gres}`,
      `--time=${options.time}`,
      `--account=${options.account}`,
      `--job-name=${options.jobName}`,
      `--wrap="sleep 1"`,
    ];

    if (options.nodes) args.push(`--nodes=${options.nodes}`);
    if (options.ntasks) args.push(`--ntasks=${options.ntasks}`);
    if (options.features && options.features.length > 0) {
      args.push(`--constraint=${options.features.join("&")}`);
    }

    const output = await this.ssh.exec(
      `sbatch --test-only ${args.join(" ")} 2>&1 || true`,
    );

    // Try to parse estimated start time
    // Format: "sbatch: Job 12345 to start at 2024-03-15T10:30:00..."
    const dateMatch = output.match(
      /to start at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
    );

    return {
      estimatedStart: dateMatch ? new Date(dateMatch[1]!) : null,
      rawOutput: output,
    };
  }

  async writeEnvFile(
    jobId: string,
    envVars: Record<string, string>,
  ): Promise<void> {
    const envDir = PATHS.envFiles(this.user);
    const content = Object.entries(envVars)
      .map(([key, value]) => `export ${key}="${value}"`)
      .join("\n");
    await this.ssh.writeFile(`${envDir}/${jobId}.env`, content + "\n");
  }

  // --- Batched query (single SSH call) ---

  async getSystemState(partitions?: string[]): Promise<SystemState> {
    const partitionArg = partitions
      ? `-p ${partitions.join(",")}`
      : "-p gpu,gpu-mig,interactive-rtx3090,gpu-a6000,gpu-a40,gpu-a100-40,gpu-a100-80,gpu-v100,gpu-h200";

    const [sinfoOut, squeueRunOut, squeuePendOut, sshareOut] =
      await this.ssh.execBatch([
        `sinfo --Node ${partitionArg} -o "${SINFO_FORMAT}" --noheader`,
        `squeue --all -u ${this.user} -t RUNNING -o "${SQUEUE_FORMAT}" --noheader`,
        `squeue --all -u ${this.user} -t PENDING -o "${SQUEUE_FORMAT}" --noheader`,
        `sshare -u ${this.user} -l`,
      ]);

    return {
      nodes: parseSinfo(sinfoOut ?? ""),
      runningJobs: parseSqueue(squeueRunOut ?? ""),
      pendingJobs: parseSqueue(squeuePendOut ?? ""),
      fairshare: parseSshare(sshareOut ?? ""),
      timestamp: new Date(),
    };
  }
}
