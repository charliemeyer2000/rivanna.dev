import { Metadata } from "next";
import fs from "fs";
import path from "path";

export const metadata: Metadata = {
  title: "changelog | rivanna.dev docs",
  description: "rv CLI version history and release notes",
};

interface ChangelogEntry {
  version: string;
  date: string;
  url: string;
  sections: { heading: string; items: { text: string; url: string }[] }[];
  empty?: boolean;
}

function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const lines = markdown.split("\n");
  let current: ChangelogEntry | null = null;
  let currentSection: {
    heading: string;
    items: { text: string; url: string }[];
  } | null = null;

  for (const line of lines) {
    // Version header: ## [0.0.23](url) (2026-02-23)
    const versionMatch = line.match(
      /^## \[([^\]]+)\]\(([^)]+)\) \((\d{4}-\d{2}-\d{2})\)/,
    );
    if (versionMatch) {
      if (current) entries.push(current);
      current = {
        version: versionMatch[1],
        url: versionMatch[2],
        date: versionMatch[3],
        sections: [],
      };
      currentSection = null;
      continue;
    }

    if (!current) continue;

    // Section header: ### Features
    const sectionMatch = line.match(/^### (.+)/);
    if (sectionMatch) {
      currentSection = { heading: sectionMatch[1], items: [] };
      current.sections.push(currentSection);
      continue;
    }

    // Empty marker
    if (line.includes("No notable changes.")) {
      current.empty = true;
      continue;
    }

    // List item: * or - **scope:** message ([sha](url))
    const itemMatch = line.match(/^[*-] (.+)/);
    if (itemMatch && currentSection) {
      // Extract the link if present
      const linkMatch = itemMatch[1].match(
        /^(.*?)\s*\(\[([a-f0-9]+)\]\(([^)]+)\)\)\s*$/,
      );
      if (linkMatch) {
        currentSection.items.push({
          text: linkMatch[1],
          url: linkMatch[3],
        });
      } else {
        currentSection.items.push({ text: itemMatch[1], url: "" });
      }
    }
  }

  if (current) entries.push(current);
  return entries;
}

function formatText(text: string) {
  // Convert **bold** to <strong>
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      return (
        <strong key={i} className="text-black">
          {boldMatch[1]}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function ChangelogPage() {
  const changelogPath = path.join(process.cwd(), "../../apps/cli/CHANGELOG.md");
  const markdown = fs.readFileSync(changelogPath, "utf-8");
  const entries = parseChangelog(markdown);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-semibold mb-4">changelog</h2>
        <p className="text-gray-600 mb-6">
          version history and release notes for the rv CLI.
        </p>
      </section>

      {entries.map((entry) => (
        <section
          key={entry.version}
          id={`v${entry.version}`}
          className="border border-gray-200 p-4 sm:p-6 space-y-3"
        >
          <div className="flex items-baseline gap-3">
            <a
              href={entry.url}
              className="text-lg font-semibold text-black hover:text-orange-accent transition-colors"
            >
              v{entry.version}
            </a>
            <span className="text-xs text-gray-400">{entry.date}</span>
          </div>

          {entry.empty ? (
            <p className="text-sm text-gray-400 italic">No notable changes.</p>
          ) : (
            entry.sections.map((section) => (
              <div key={section.heading} className="space-y-1">
                <h4 className="text-sm font-medium text-gray-500">
                  {section.heading.toLowerCase()}
                </h4>
                <ul className="space-y-1">
                  {section.items.map((item, i) => (
                    <li
                      key={i}
                      className="text-sm text-gray-600 flex items-start gap-2"
                    >
                      <span className="text-gray-300 mt-0.5 flex-shrink-0">
                        -
                      </span>
                      <span>
                        {formatText(item.text)}
                        {item.url && (
                          <>
                            {" "}
                            <a
                              href={item.url}
                              className="text-xs text-gray-400 hover:text-orange-accent transition-colors"
                            >
                              {item.url.split("/").pop()?.slice(0, 7)}
                            </a>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
