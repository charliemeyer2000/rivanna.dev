import type { Command } from "commander";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import { shellJoin } from "@/lib/shell-quote.ts";

export function registerExecCommand(program: Command) {
  program
    .command("exec")
    .description("Run a command on the Rivanna login node (no GPU)")
    .passThroughOptions()
    .argument("<command...>", "command to run remotely")
    .option("--json", "output as JSON")
    .option(
      "--timeout <seconds>",
      "SSH command timeout in seconds (default: 120)",
    )
    .action(
      async (
        commandParts: string[],
        options: { json?: boolean; timeout?: string },
      ) => {
        try {
          await runExec(commandParts, options);
        } catch (error) {
          if (options.json) {
            console.log(
              JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          } else if (error instanceof Error) {
            console.error(theme.error(`\nError: ${error.message}`));
          }
          process.exit(1);
        }
      },
    );
}

async function runExec(
  commandParts: string[],
  options: { json?: boolean; timeout?: string },
) {
  const { slurm } = ensureSetup();
  // Single arg = user provided a shell string; pass through as-is.
  // Multiple args = individual tokens; shellJoin for POSIX safety.
  const command =
    commandParts.length === 1 ? commandParts[0]! : shellJoin(commandParts);

  const timeoutMs = options.timeout
    ? parseInt(options.timeout, 10) * 1000
    : 120_000;
  const output = await slurm.sshClient.exec(command, { timeoutMs });

  if (options.json) {
    console.log(JSON.stringify({ output }));
  } else {
    process.stdout.write(output);
    if (!output.endsWith("\n")) process.stdout.write("\n");
  }
}
