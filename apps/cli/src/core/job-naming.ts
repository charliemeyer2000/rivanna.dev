/**
 * Smart job name generation from entrypoint commands.
 *
 * Parse-based naming is always used. LLM-based naming is opt-in
 * when the user has an API key configured via `rv env`.
 */

const LAUNCHERS = new Set([
  "python",
  "python3",
  "uv",
  "run",
  "torchrun",
  "accelerate",
  "launch",
  "deepspeed",
  "bash",
  "sh",
  "exec",
  "env",
  "nohup",
  "time",
  "srun",
]);

function extractScriptName(command: string): string {
  const parts = command.trim().split(/\s+/);
  let meaningful = "";
  let skipNext = false;

  for (const part of parts) {
    // Skip flag arguments (e.g., the "4" after "--nproc 4")
    if (skipNext) {
      skipNext = false;
      continue;
    }

    // Skip launchers
    if (LAUNCHERS.has(part)) continue;

    // Skip flags — and skip the next token if it's a value flag
    if (part.startsWith("-")) {
      // Flags like --nproc, --num_processes take a value argument
      if (!part.includes("=")) skipNext = true;
      continue;
    }

    // If it looks like a file path, take the basename without extension
    if (part.includes(".") || part.includes("/")) {
      const base = part
        .split("/")
        .pop()!
        .replace(/\.[^.]+$/, "");
      meaningful = base;
      break;
    }

    // First non-launcher, non-flag token
    meaningful = part;
    break;
  }

  return meaningful || "job";
}

function sanitizeJobName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
}

/**
 * Generate a job name from a command string.
 * Always available, no external calls.
 */
export function generateJobName(command?: string): string {
  if (!command) return "rv-interactive";

  const script = extractScriptName(command);
  const sanitized = sanitizeJobName(script);
  return `rv-${sanitized || "job"}`;
}

/**
 * Generate a job name using an LLM. Returns null on any failure.
 * 3-second timeout, zero dependencies (uses built-in fetch).
 */
export async function generateAIJobName(
  command: string,
  apiKey: string,
  provider: "openai" | "anthropic",
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const prompt =
      "Generate a short (2-4 word) descriptive job name for this HPC command. Return ONLY the name, lowercase, words joined by hyphens. No explanation.\n\nCommand: " +
      command;

    let name: string | null = null;

    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 20,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      name = data.choices?.[0]?.message?.content?.trim() ?? null;
    } else {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 20,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
      const data = (await res.json()) as {
        content?: { text?: string }[];
      };
      name = data.content?.[0]?.text?.trim() ?? null;
    }

    if (!name) return null;
    const sanitized = sanitizeJobName(name);
    return sanitized || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
