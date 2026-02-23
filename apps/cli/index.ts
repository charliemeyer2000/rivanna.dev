import { Command } from "commander";
import { registerInitCommand } from "./src/commands/init.ts";
import { registerUpCommand } from "./src/commands/up.ts";
import { registerRunCommand } from "./src/commands/run.ts";
import { registerPsCommand } from "./src/commands/ps.ts";
import { registerStopCommand } from "./src/commands/stop.ts";
import { registerSshCommand } from "./src/commands/ssh-cmd.ts";
import { registerLogsCommand } from "./src/commands/logs.ts";
import { registerStatusCommand } from "./src/commands/status.ts";
import { registerSyncCommand } from "./src/commands/sync.ts";
import { registerForwardCommand } from "./src/commands/forward.ts";
import { registerEnvCommand } from "./src/commands/env.ts";
import { registerCostCommand } from "./src/commands/cost.ts";
import { registerExecCommand } from "./src/commands/exec.ts";
import { registerGpuCommand } from "./src/commands/gpu.ts";
import { registerUpgradeCommand } from "./src/commands/upgrade.ts";
import { checkForUpdate } from "./src/lib/version-check.ts";

const pkg = require("./package.json");

async function main() {
  const program = new Command();

  program
    .version(pkg.version)
    .name("rv")
    .enablePositionalOptions()
    .description("effortless GPU computing on UVA's Rivanna cluster")
    .addHelpText(
      "after",
      "\nDocs:  https://rivanna.dev/docs\nLLMs:  https://rivanna.dev/llms.txt",
    );

  registerInitCommand(program);
  registerUpCommand(program);
  registerRunCommand(program);
  registerPsCommand(program);
  registerStopCommand(program);
  registerSshCommand(program);
  registerLogsCommand(program);
  registerStatusCommand(program);
  registerSyncCommand(program);
  registerForwardCommand(program);
  registerEnvCommand(program);
  registerCostCommand(program);
  registerExecCommand(program);
  registerGpuCommand(program);
  registerUpgradeCommand(program);

  await checkForUpdate().catch(() => {});

  program.parse(process.argv);
}

main();
