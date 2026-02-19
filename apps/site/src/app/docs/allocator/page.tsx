import { Metadata } from "next";
import { CodeBlock } from "../_components/code-block";

export const metadata: Metadata = {
  title: "smart allocator | rivanna.dev docs",
  description: "how rv's smart GPU allocation works",
};

export default function AllocatorPage() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-semibold mb-4">smart allocator</h2>
        <p className="text-gray-600 mb-6">
          rv doesn&apos;t just submit to one partition and wait. it probes the
          cluster, generates every compatible strategy, and submits them all in
          parallel. the first one to start running wins — the rest get
          cancelled.
        </p>
      </section>

      <section
        id="how-it-works"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">how it works</h3>
        <ol className="space-y-3 text-sm text-gray-600 list-decimal list-inside">
          <li>
            <strong className="text-black">probe cluster</strong> — rv queries
            Slurm for current GPU availability, queue depth, and backfill
            windows across all partitions
          </li>
          <li>
            <strong className="text-black">generate strategies</strong> — for
            your requested GPU count, rv generates all compatible combinations:
            GPU type, partition, single-node vs multi-node topology, direct vs
            backfill vs checkpoint-restart
          </li>
          <li>
            <strong className="text-black">rank and prune</strong> — strategies
            are ranked by estimated wait time and SU cost. dominated strategies
            (same GPU type and topology but worse on all metrics) are pruned
          </li>
          <li>
            <strong className="text-black">fan-out submit</strong> — all
            surviving strategies are submitted to Slurm simultaneously
          </li>
          <li>
            <strong className="text-black">first wins</strong> — rv monitors all
            submissions. the first job to reach RUNNING state wins; all other
            pending jobs are cancelled
          </li>
        </ol>
        <CodeBlock>
          <code className="text-sm text-black">
            rv up --dry-run
            <span className="text-gray-400">
              {" "}
              # see all strategies without submitting
            </span>
          </code>
        </CodeBlock>
      </section>

      <section
        id="fan-out"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">fan-out strategy</h3>
        <p className="text-sm text-gray-600">
          when you request GPUs without specifying a type, rv submits to every
          compatible partition at once. for example, requesting 4 GPUs might
          generate strategies for A6000, A40, A100 (40GB), A100 (80GB), V100,
          and multi-node variants (2x2) for each.
        </p>
        <p className="text-sm text-gray-600">
          this works because Slurm allows multiple pending jobs. whichever
          partition has resources first wins. rv cancels the losers
          automatically — you&apos;re never charged for jobs that don&apos;t
          run.
        </p>
        <p className="text-sm text-gray-600">
          if you specify a GPU type with{" "}
          <code className="text-orange-accent">--type</code>, rv only generates
          strategies for that type (but still explores single-node, multi-node,
          direct, and backfill variants).
        </p>
      </section>

      <section
        id="backfill"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">backfill detection</h3>
        <p className="text-sm text-gray-600">
          Slurm&apos;s backfill scheduler can start smaller/shorter jobs ahead
          of the queue if they fit in the gaps. rv detects these windows using{" "}
          <code className="text-orange-accent">sbatch --test-only</code> and
          generates backfill strategies with{" "}
          <code className="text-orange-accent">--time-min</code> set to the
          detected window.
        </p>
        <p className="text-sm text-gray-600">
          this is why the default walltime of{" "}
          <code className="text-orange-accent">2:59:00</code> is recommended —
          jobs under 3 hours are most likely to find backfill opportunities.
        </p>
      </section>

      <section
        id="checkpoint-restart"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">checkpoint-restart</h3>
        <p className="text-sm text-gray-600">
          for long-running jobs (e.g. 24h training), rv can break the work into
          segments that fit within backfill windows. each segment:
        </p>
        <ol className="space-y-2 text-sm text-gray-600 list-decimal list-inside">
          <li>
            runs your command with a{" "}
            <code className="text-orange-accent">timeout</code> set to the
            walltime minus a 10-minute buffer
          </li>
          <li>
            sends <code className="text-orange-accent">SIGUSR1</code> to your
            process before time expires (your code should save a checkpoint)
          </li>
          <li>
            auto-resubmits the same script with{" "}
            <code className="text-orange-accent">RV_TOTAL_ELAPSED</code>{" "}
            tracking cumulative time
          </li>
          <li>
            stops resubmitting once the total requested time has been reached
          </li>
        </ol>
        <p className="text-sm text-gray-600">
          checkpoint strategies only appear when backfill windows are available
          but shorter than your total requested time. your training code needs
          to handle SIGUSR1 by saving state and resuming from the latest
          checkpoint on restart.
        </p>
      </section>

      <section
        id="gpu-types"
        className="border border-gray-200 p-4 sm:p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-black">gpu types</h3>
        <p className="text-sm text-gray-600 mb-3">
          available GPU types on Rivanna. MIG slices are free and don&apos;t
          consume SUs.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-gray-200">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  type
                </th>
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  VRAM
                </th>
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  SU/GPU-hr
                </th>
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  max/user
                </th>
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  max/job
                </th>
                <th className="px-3 py-2 border-b border-gray-200 font-medium">
                  per node
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100 bg-orange-accent/5">
                <td className="px-3 py-2 font-mono text-xs">mig</td>
                <td className="px-3 py-2 text-gray-600">10 GB</td>
                <td className="px-3 py-2 text-gray-600 font-medium">free</td>
                <td className="px-3 py-2 text-gray-600">28</td>
                <td className="px-3 py-2 text-gray-600">1</td>
                <td className="px-3 py-2 text-gray-600">56</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-3 py-2 font-mono text-xs">v100</td>
                <td className="px-3 py-2 text-gray-600">32 GB</td>
                <td className="px-3 py-2 text-gray-600">20.96</td>
                <td className="px-3 py-2 text-gray-600">32</td>
                <td className="px-3 py-2 text-gray-600">4</td>
                <td className="px-3 py-2 text-gray-600">4</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-3 py-2 font-mono text-xs">rtx3090</td>
                <td className="px-3 py-2 text-gray-600">24 GB</td>
                <td className="px-3 py-2 text-gray-600">113.23</td>
                <td className="px-3 py-2 text-gray-600">2</td>
                <td className="px-3 py-2 text-gray-600">2</td>
                <td className="px-3 py-2 text-gray-600">4</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-3 py-2 font-mono text-xs">a6000</td>
                <td className="px-3 py-2 text-gray-600">48 GB</td>
                <td className="px-3 py-2 text-gray-600">142.73</td>
                <td className="px-3 py-2 text-gray-600">32</td>
                <td className="px-3 py-2 text-gray-600">8</td>
                <td className="px-3 py-2 text-gray-600">8</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-3 py-2 font-mono text-xs">a40</td>
                <td className="px-3 py-2 text-gray-600">48 GB</td>
                <td className="px-3 py-2 text-gray-600">186.69</td>
                <td className="px-3 py-2 text-gray-600">32</td>
                <td className="px-3 py-2 text-gray-600">8</td>
                <td className="px-3 py-2 text-gray-600">8</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-3 py-2 font-mono text-xs">a100_40</td>
                <td className="px-3 py-2 text-gray-600">40 GB</td>
                <td className="px-3 py-2 text-gray-600">463.81</td>
                <td className="px-3 py-2 text-gray-600">32</td>
                <td className="px-3 py-2 text-gray-600">8</td>
                <td className="px-3 py-2 text-gray-600">8</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-3 py-2 font-mono text-xs">a100_80</td>
                <td className="px-3 py-2 text-gray-600">80 GB</td>
                <td className="px-3 py-2 text-gray-600">508.89</td>
                <td className="px-3 py-2 text-gray-600">32</td>
                <td className="px-3 py-2 text-gray-600">8</td>
                <td className="px-3 py-2 text-gray-600">8</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-3 py-2 font-mono text-xs">h200</td>
                <td className="px-3 py-2 text-gray-600">141 GB</td>
                <td className="px-3 py-2 text-gray-600">816.67</td>
                <td className="px-3 py-2 text-gray-600">4</td>
                <td className="px-3 py-2 text-gray-600">4</td>
                <td className="px-3 py-2 text-gray-600">8</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">
          A100 (80GB) nodes have InfiniBand and NVLink interconnects. use{" "}
          <code className="text-orange-accent">rv cost</code> to estimate SU
          costs for your job configuration.
        </p>
      </section>
    </div>
  );
}
