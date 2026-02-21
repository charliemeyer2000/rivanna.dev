import readline from "readline";
import { theme } from "./theme.ts";

// --------------- ANSI Utilities ---------------

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

// --------------- Types ---------------

export interface TableOptions {
  headers: string[];
  rows: string[][];
  /** Left indent in spaces (default: 2) */
  indent?: number;
}

export interface InteractiveTableOptions extends TableOptions {
  /** Row count at which pagination activates (default: 7) */
  pageThreshold?: number;
}

// --------------- Shared Internals ---------------

function computeColumnWidths(headers: string[], rows: string[][]): number[] {
  return headers.map((header, index) => {
    const cellWidths = rows.map((row) => stripAnsi(row[index] ?? "").length);
    return Math.max(stripAnsi(header).length, ...cellWidths);
  });
}

function buildRowRenderer(widths: number[], indent: number) {
  const pad = " ".repeat(indent);
  return (cols: string[]) =>
    pad +
    cols
      .map((col, index) => {
        const gap = index < cols.length - 1 ? 2 : 0;
        const padding = (widths[index] ?? 0) - stripAnsi(col).length + gap;
        return `${col}${" ".repeat(Math.max(0, padding))}`;
      })
      .join("")
      .trimEnd();
}

// --------------- Static Table ---------------

/**
 * Render a table to stdout. Always prints all rows (no pagination).
 * Use for small, bounded data sets (GPU availability, storage, cost comparison).
 */
export function renderTable(options: TableOptions): void {
  const { headers, rows, indent = 2 } = options;
  const widths = computeColumnWidths(headers, rows);
  const render = buildRowRenderer(widths, indent);

  console.log(render(headers.map((h) => theme.muted(h))));
  for (const row of rows) {
    console.log(render(row));
  }
}

// --------------- Interactive (Paginated) Table ---------------

/**
 * Render a table that paginates when row count exceeds the threshold.
 *
 * - Below threshold or non-TTY: prints statically (same as renderTable).
 * - Above threshold: shows one page at a time with keyboard navigation.
 *   Arrow keys / h,l to page. q / ESC / Ctrl+C to exit.
 */
export async function renderInteractiveTable(
  options: InteractiveTableOptions,
): Promise<void> {
  const { headers, rows, indent = 2, pageThreshold = 7 } = options;
  const widths = computeColumnWidths(headers, rows);
  const render = buildRowRenderer(widths, indent);

  // Non-TTY or small data set: static render
  if (!process.stdout.isTTY || rows.length <= pageThreshold) {
    console.log(render(headers.map((h) => theme.muted(h))));
    for (const row of rows) {
      console.log(render(row));
    }
    return;
  }

  // Paginated mode
  const terminalHeight = process.stdout.rows || 24;
  // Reserve: header row, blank before footer, footer line, trailing newline
  const pageSize = Math.max(5, terminalHeight - 4);
  const totalPages = Math.ceil(rows.length / pageSize);
  let currentPage = 0;

  function getPageRows(page: number): string[][] {
    const start = page * pageSize;
    return rows.slice(start, start + pageSize);
  }

  function renderFooter(): string {
    const pageInfo = theme.emphasis(`Page ${currentPage + 1}/${totalPages}`);
    const countInfo = theme.muted(`(${rows.length} total)`);
    const navHelp = theme.muted("\u2190/\u2192 navigate, q quit");
    return `${" ".repeat(indent)}${pageInfo}  ${countInfo}  ${navHelp}`;
  }

  // Print header once (stays on screen)
  console.log(render(headers.map((h) => theme.muted(h))));

  function printPage(): void {
    const pageRows = getPageRows(currentPage);
    for (let i = 0; i < pageSize; i++) {
      if (i < pageRows.length) {
        process.stdout.write(render(pageRows[i]!) + "\n");
      } else {
        // Clear leftover lines from a previous longer page
        process.stdout.write("\x1b[2K\n");
      }
    }
    process.stdout.write("\n");
    process.stdout.write("\x1b[2K" + renderFooter());
  }

  function redrawPage(): void {
    // Move cursor up past: pageSize data lines + blank + footer
    const linesToMoveUp = pageSize + 2;
    process.stdout.write(`\x1b[${linesToMoveUp}A\r`);
    printPage();
  }

  printPage();

  return new Promise<void>((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);

    function cleanup(): void {
      process.stdin.removeListener("keypress", onKeypress);
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
    }

    function onKeypress(
      _str: string | undefined,
      key: { name: string; ctrl?: boolean },
    ): void {
      if (!key) return;

      if (key.name === "right" || key.name === "l") {
        if (currentPage < totalPages - 1) {
          currentPage++;
          redrawPage();
        }
      } else if (key.name === "left" || key.name === "h") {
        if (currentPage > 0) {
          currentPage--;
          redrawPage();
        }
      } else if (key.name === "q" || key.name === "escape") {
        cleanup();
        console.log("\n");
        resolve();
      } else if (key.ctrl && key.name === "c") {
        cleanup();
        console.log("\n");
        resolve();
      }
    }

    process.stdin.on("keypress", onKeypress);
    process.stdin.resume();
  });
}
