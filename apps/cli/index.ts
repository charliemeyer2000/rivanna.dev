import { Command } from "commander";
import { registerInitCommand } from "./src/commands/init.ts";
import { registerUpCommand } from "./src/commands/up.ts";
import { registerRunCommand } from "./src/commands/run.ts";
import { registerPsCommand } from "./src/commands/ps.ts";
import { registerStopCommand } from "./src/commands/stop.ts";
import { registerAttachCommand } from "./src/commands/attach.ts";

const pkg = require("./package.json");

async function main() {
  const program = new Command();

  program
    .version(pkg.version)
    .name("rv")
    .description("effortless GPU computing on UVA's Rivanna cluster");

  registerInitCommand(program);
  registerUpCommand(program);
  registerRunCommand(program);
  registerPsCommand(program);
  registerStopCommand(program);
  registerAttachCommand(program);

  program.parse(process.argv);
}

main();
