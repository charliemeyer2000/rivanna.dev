import { Metadata } from "next";
import { CodeBlock } from "./_components/code-block";

export const metadata: Metadata = {
  title: "getting started | rivanna.dev docs",
  description: "install rv and run your first GPU job on Rivanna",
};

export default function DocsPage() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-semibold mb-4">getting started</h2>
        <p className="text-gray-600 mb-6">
          rv is a CLI for running GPU jobs on UVA&apos;s Rivanna cluster. no
          SLURM scripts, no partition guessing — one command to submit.
        </p>
      </section>

      <section className="border border-gray-200 p-4 sm:p-6 space-y-6">
        <div id="install">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl font-semibold text-black">1</span>
            <h3 className="text-lg font-semibold text-black">install</h3>
          </div>
          <div className="pl-9">
            <p className="text-sm text-gray-600 mb-3">
              run this in your terminal (macOS or Linux):
            </p>
            <CodeBlock>
              <code className="text-sm text-black">
                curl -fsSL https://rivanna.dev/install.sh | bash
              </code>
            </CodeBlock>
            <p className="text-xs text-gray-500 mt-2">
              installs to ~/.local/bin/rv. supports macOS (x86_64, arm64) and
              Linux (x86_64).
            </p>
          </div>
        </div>

        <div id="setup">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl font-semibold text-black">2</span>
            <h3 className="text-lg font-semibold text-black">setup</h3>
          </div>
          <div className="pl-9">
            <p className="text-sm text-gray-600 mb-3">
              run the interactive setup wizard:
            </p>
            <CodeBlock>
              <code className="text-sm text-black">rv init</code>
            </CodeBlock>
            <p className="text-xs text-gray-500 mt-2">
              this will ask for your UVA computing ID, check VPN connectivity,
              set up SSH keys, discover your Slurm account, and configure the
              remote environment. you need to be connected to the{" "}
              <a
                href="https://virginia.service-now.com/its?id=itsweb_kb_article&sys_id=f24e5cdfdb3acb804f32fb671d9619d0"
                className="text-orange-accent underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                UVA Anywhere VPN
              </a>{" "}
              to continue.
            </p>
          </div>
        </div>

        <div id="first-job">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl font-semibold text-black">3</span>
            <h3 className="text-lg font-semibold text-black">first job</h3>
          </div>
          <div className="pl-9">
            <p className="text-sm text-gray-600 mb-3">
              try a free MIG GPU slice (no SU cost, instant allocation):
            </p>
            <CodeBlock className="mb-3">
              <code className="text-sm text-black">rv up --mig</code>
            </CodeBlock>
            <p className="text-sm text-gray-600 mb-3">
              or run a script in batch mode:
            </p>
            <CodeBlock className="mb-3">
              <code className="text-sm text-black">rv run python train.py</code>
            </CodeBlock>
            <p className="text-sm text-gray-600 mb-3">
              check your cluster status:
            </p>
            <CodeBlock>
              <code className="text-sm text-black">rv status</code>
            </CodeBlock>
          </div>
        </div>
      </section>

      <section id="whats-next">
        <h2 className="text-xl font-semibold mb-4">what&apos;s next?</h2>
        <ul className="space-y-2 text-gray-600">
          <li>
            <a href="/docs/commands" className="text-orange-accent underline">
              commands
            </a>{" "}
            — full reference for all 14 rv commands
          </li>
          <li>
            <a href="/docs/allocator" className="text-orange-accent underline">
              smart allocator
            </a>{" "}
            — how fan-out strategy and backfill detection work
          </li>
          <li>
            <a
              href="/docs/configuration"
              className="text-orange-accent underline"
            >
              configuration
            </a>{" "}
            — config file, environment variables, notifications
          </li>
        </ul>
      </section>
    </div>
  );
}
