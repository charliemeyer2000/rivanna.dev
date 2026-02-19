import Link from "next/link";
import { CodeBlock } from "./docs/_components/code-block";

export default function Home() {
  return (
    <main className="max-w-3xl mx-auto px-8 py-8 min-h-screen font-mono">
      <div>
        <div className="mb-8">
          <h1 className="text-4xl font-normal leading-tight">
            rivanna<span className="text-orange-accent">.dev</span>
          </h1>
          <p className="mt-2 text-base text-gray-600">
            effortless GPU computing on UVA&apos;s Rivanna cluster
          </p>
        </div>

        <h2 className="text-xl font-semibold mt-8 mb-4 text-black">install</h2>
        <CodeBlock className="mb-4">
          <code className="text-sm text-black">
            curl -fsSL https://rivanna.dev/install.sh | bash
          </code>
        </CodeBlock>

        <h2 className="text-xl font-semibold mt-8 mb-4 text-black">
          quickstart
        </h2>
        <div className="space-y-2">
          <CodeBlock>
            <code className="text-sm text-black">
              rv init
              <span className="text-gray-400">
                {"            "}# one-time setup
              </span>
            </code>
          </CodeBlock>
          <CodeBlock>
            <code className="text-sm text-black">
              rv up --mig
              <span className="text-gray-400">
                {"        "}# free GPU, instant
              </span>
            </code>
          </CodeBlock>
          <CodeBlock>
            <code className="text-sm text-black">
              rv run python train.py
              <span className="text-gray-400"> # submit a job</span>
            </code>
          </CodeBlock>
        </div>

        <p className="mt-8 text-base">
          read the{" "}
          <Link href="/docs" className="text-orange-accent underline">
            docs
          </Link>
        </p>

        <footer className="mt-16 pt-4 border-t border-gray-200">
          <ul className="list-none mb-2 space-y-1 text-sm">
            <li>
              <a
                href="mailto:charlie@charliemeyer.xyz"
                className="text-orange-accent underline"
              >
                contact
              </a>
            </li>
            <li>
              <a
                href="https://github.com/charliemeyer2000/rivanna.dev"
                className="text-orange-accent underline"
              >
                github
              </a>
            </li>
          </ul>
        </footer>
      </div>
    </main>
  );
}
