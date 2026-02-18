import { Command } from "commander";
import { registerInitCommand } from "./src/commands/init.ts";

const pkg = require("./package.json");

async function main() {
  const program = new Command();

  program
    .version(pkg.version)
    .name("rv")
    .description("effortless GPU computing on UVA's Rivanna cluster");

  registerInitCommand(program);

  program.parse(process.argv);
}

main();
