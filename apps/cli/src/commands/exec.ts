import type { Command } from "commander";
import { ensureSetup } from "@/lib/setup.ts";
import { theme } from "@/lib/theme.ts";
import { shellJoin } from "@/lib/shell-quote.ts";

export function registerExecCommand(program: Command) {
  program
    .command("exec")
    .description("Run a command on the Rivanna login node (no GPU)")
    .argument("<command...>", "command to run remotely")
    .option("--json", "output as JSON")
    .action(async (commandParts: string[], options: { json?: boolean }) => {
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
    });
}

async function runExec(commandParts: string[], options: { json?: boolean }) {
  const { slurm } = ensureSetup();
  const command = shellJoin(commandParts);

  const output = await slurm.sshClient.exec(command);

  if (options.json) {
    console.log(JSON.stringify({ output }));
  } else {
    process.stdout.write(output);
    if (!output.endsWith("\n")) process.stdout.write("\n");
  }
}
