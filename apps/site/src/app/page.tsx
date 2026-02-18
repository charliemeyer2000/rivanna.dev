import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-3xl mx-auto px-8 py-8 min-h-screen font-mono">
      <div>
        <div className="mb-8">
          <h1 className="text-4xl font-normal leading-tight">
            rivanna<span className="text-orange-accent">.dev</span>
          </h1>
        </div>
        <p className="mb-4 text-base leading-relaxed">
          effortless GPU computing on UVA&apos;s Rivanna cluster
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-4 text-black">
          the rv cli
        </h2>
        <p className="mb-4 text-base leading-relaxed">
          rv is a command-line tool that makes it dead simple to run GPU jobs on
          Rivanna. no more writing SLURM scripts by hand, no more guessing
          partition names, no more SSH gymnastics. one command to initialize,
          one command to submit.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-4 text-black">install</h2>
        <p className="mb-4 text-base leading-relaxed">
          install rv with a single command. supports macOS (x86_64, arm64) and
          Linux (x86_64).
        </p>
        <pre className="mb-4 rounded-lg border bg-card p-4 text-sm overflow-x-auto">
          curl -fsSL https://rivanna.dev/install.sh | bash
        </pre>

        <h2 className="text-xl font-semibold mt-8 mb-4 text-black">
          how it works
        </h2>
        <p className="mb-4 text-base leading-relaxed">
          run <code className="text-orange-accent">rv init</code> in your
          project directory to generate a config file. pick your GPU, set your
          resource limits, and point to your script. then run{" "}
          <code className="text-orange-accent">rv submit</code> to send it to
          Rivanna. rv handles the SLURM translation, file syncing, and job
          monitoring for you.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-4 text-black">
          supported gpus
        </h2>
        <p className="mb-4 text-base leading-relaxed">
          rv supports all GPU partitions available on Rivanna, including A100
          (80GB), RTX 3090, RTX 2080 Ti, V100, K80, and more. specify your GPU
          by name and rv figures out the correct partition, gres string, and
          resource limits automatically.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-4 text-black">
          documentation
        </h2>
        <p className="mb-4 text-base leading-relaxed">
          learn how to use rv with our{" "}
          <Link href="/docs" className="text-orange-accent underline">
            documentation
          </Link>
          .
        </p>

        <footer className="mt-16 pt-4 border-t border-gray-200">
          <h3 className="text-base font-normal text-footer-grey italic">
            all content &copy; 2026 rivanna.dev
          </h3>
          <ul className="list-none mb-2 space-y-1 italic">
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
