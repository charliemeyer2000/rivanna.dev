import chalk from "chalk";

export const theme = {
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  muted: chalk.gray,
  accent: chalk.cyan,
  emphasis: chalk.bold,
} as const;

export function formatSectionHeader(text: string): string {
  return theme.info(`\n${text}:`);
}

export function formatDetail(label: string, value: string): string {
  return theme.muted(`  ${label}: ${value}`);
}

export function formatCommand(command: string): string {
  return theme.accent(`  ${command}`);
}
