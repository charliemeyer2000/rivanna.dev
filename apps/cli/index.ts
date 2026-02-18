import { Command } from "commander";

const pkg = require("./package.json");

async function main() {
  const program = new Command();

  program
    .version(pkg.version)
    .name("rv")
    .description("effortless GPU computing on UVA's Rivanna cluster");

  program.parse(process.argv);
}

main();
