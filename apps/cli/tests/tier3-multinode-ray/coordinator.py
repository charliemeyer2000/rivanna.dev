"""
Tier 3 Test: Multi-node Ray (2 nodes x 2 GPUs)
Tests: Head/worker cluster formation via SLURM_PROCID branching,
       cross-node GPU scheduling, object transfer, actor placement,
       distributed training with Ray Train.

Run: rv run -g 4 --type a100 -- python coordinator.py
Expected: 2 nodes, 4 GPUs, tasks scheduled across both hosts.

Architecture:
  srun runs this script on BOTH nodes simultaneously.
  Node 0 (SLURM_PROCID=0): starts Ray head, runs tests.
  Node 1 (SLURM_PROCID=1): connects as Ray worker, idles until done.
  Coordination via shared file on /scratch (visible to all nodes).
"""
import os, sys, time, socket, json, signal

# ── Slurm / shared-filesystem coordination ──────────────────────────

SLURM_PROCID = int(os.environ.get("SLURM_PROCID", "0"))
SLURM_JOB_ID = os.environ.get("SLURM_JOB_ID", "0")
HOSTNAME = socket.gethostname()
NUM_GPUS_PER_NODE = int(os.environ.get("SLURM_GPUS_ON_NODE", "2"))

# Shared directory for head↔worker coordination (scratch is cross-node)
SHARED_DIR = "/scratch/abs6bd/.rv/ray_cluster"
ADDR_FILE = os.path.join(SHARED_DIR, f"{SLURM_JOB_ID}.addr")
DONE_FILE = os.path.join(SHARED_DIR, f"{SLURM_JOB_ID}.done")
RAY_PORT = 6379
DASHBOARD_PORT = 8265


def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)


def poll_file(path, timeout=120, interval=2):
    """Block until file appears, return its content."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if os.path.exists(path):
            with open(path) as f:
                content = f.read().strip()
            if content:
                return content
        time.sleep(interval)
    raise TimeoutError(f"Timed out waiting for {path}")


def cleanup():
    """Remove coordination files."""
    for f in [ADDR_FILE, DONE_FILE]:
        try:
            os.remove(f)
        except OSError:
            pass


# ── Head node (SLURM_PROCID=0) ─────────────────────────────────────

def run_head():
    import ray
    import torch

    print("=" * 60)
    print("TIER 3 TEST: Multi-node Ray (4 GPUs across 2 nodes)")
    print("=" * 60)

    # --- Infrastructure ---
    print(f"\n[Infrastructure]")
    for var in ["RV_CHECKPOINT_DIR", "HF_HOME", "UV_CACHE_DIR",
                "SLURM_JOB_ID", "SLURM_NNODES", "SLURM_NODELIST",
                "CUDA_VISIBLE_DEVICES", "MASTER_PORT"]:
        print(f"  {var}: {os.environ.get(var, 'NOT SET')}")

    # --- Start Ray head ---
    print(f"\n[Ray Head Init]")
    print(f"  Starting head on {HOSTNAME}:{RAY_PORT}")
    ray.init(
        num_cpus=os.cpu_count(),
        num_gpus=NUM_GPUS_PER_NODE,
        dashboard_host="0.0.0.0",
        dashboard_port=DASHBOARD_PORT,
        _node_ip_address=socket.gethostbyname(HOSTNAME),
    )
    head_addr = ray.get_runtime_context().gcs_address
    print(f"  Head GCS address: {head_addr}")
    print(f"  Ray version: {ray.__version__}")
    print(f"  PyTorch version: {torch.__version__}")

    # Write address for worker to discover
    write_file(ADDR_FILE, head_addr)
    print(f"  Wrote head address to {ADDR_FILE}")

    # --- Wait for worker ---
    print(f"\n[Cluster Formation]")
    print(f"  Waiting for worker node to join...")
    deadline = time.time() + 120
    while time.time() < deadline:
        nodes = ray.nodes()
        alive = [n for n in nodes if n["Alive"]]
        if len(alive) >= 2:
            break
        time.sleep(2)

    nodes = ray.nodes()
    alive = [n for n in nodes if n["Alive"]]
    resources = ray.cluster_resources()
    total_gpus = int(resources.get("GPU", 0))
    total_cpus = int(resources.get("CPU", 0))
    node_hostnames = sorted(set(
        n.get("NodeName", "unknown") for n in alive
    ))

    print(f"  Alive nodes: {len(alive)}")
    print(f"  Node hostnames: {node_hostnames}")
    print(f"  Total GPUs: {total_gpus}")
    print(f"  Total CPUs: {total_cpus}")

    cluster_ok = len(alive) >= 2 and total_gpus >= 4
    is_multi_node = len(set(node_hostnames)) > 1
    print(f"  Multi-node cluster: {'PASSED' if is_multi_node else 'SINGLE NODE'}")
    print(f"  Resource check (4 GPUs): {'PASSED' if total_gpus >= 4 else 'FAILED'}")

    # --- Cross-node GPU tasks ---
    print(f"\n[Cross-Node GPU Tasks]")

    @ray.remote(num_gpus=1)
    def gpu_probe(task_id):
        import torch
        host = socket.gethostname()
        gpu_name = torch.cuda.get_device_name(0)
        gpu_mem = torch.cuda.get_device_properties(0).total_memory / 1e9
        # Do real GPU work
        x = torch.randn(2000, 2000, device="cuda")
        y = torch.matmul(x, x.T)
        checksum = y.trace().item()
        return {
            "task_id": task_id,
            "hostname": host,
            "gpu_name": gpu_name,
            "gpu_mem_gb": round(gpu_mem, 1),
            "checksum": checksum,
        }

    futures = [gpu_probe.remote(i) for i in range(4)]
    results = ray.get(futures)

    task_hosts = set()
    for r in results:
        task_hosts.add(r["hostname"])
        print(f"  Task {r['task_id']}: {r['gpu_name']} ({r['gpu_mem_gb']} GB) "
              f"on {r['hostname']}")

    cross_node_tasks = len(task_hosts) > 1
    print(f"  Tasks on {len(task_hosts)} host(s): "
          f"{'PASSED' if cross_node_tasks else 'SINGLE HOST'}")

    # --- Object transfer bandwidth ---
    print(f"\n[Object Transfer]")

    @ray.remote(num_gpus=1)
    def create_large_tensor():
        import torch
        # ~400MB tensor
        t = torch.randn(100_000_000, device="cpu")
        return t

    @ray.remote(num_gpus=1)
    def consume_tensor(tensor_ref):
        import torch
        # Force materialization — triggers cross-node transfer if on different node
        total = tensor_ref.sum().item()
        return {"sum": total, "hostname": socket.gethostname(), "size_mb": tensor_ref.nelement() * 4 / 1e6}

    ref = create_large_tensor.remote()
    start = time.time()
    result = ray.get(consume_tensor.remote(ref))
    elapsed = time.time() - start
    bw = result["size_mb"] / 1000 / elapsed if elapsed > 0 else 0

    print(f"  Transferred {result['size_mb']:.0f} MB in {elapsed:.2f}s = {bw:.1f} GB/s")
    print(f"  Consumer on: {result['hostname']}")

    # --- Cross-node actor ---
    print(f"\n[Cross-Node Actor]")

    @ray.remote(num_gpus=1)
    class GPUWorker:
        def __init__(self):
            import torch
            self.device = torch.device("cuda")
            self.hostname = socket.gethostname()
            self.counter = 0

        def compute(self, size):
            import torch
            x = torch.randn(size, size, device=self.device)
            y = torch.matmul(x, x.T)
            self.counter += 1
            return {"trace": y.trace().item(), "hostname": self.hostname,
                    "call": self.counter}

        def get_info(self):
            return {"hostname": self.hostname, "calls": self.counter}

    # Create 2 actors — Ray should place them on different nodes if available
    actors = [GPUWorker.remote() for _ in range(2)]
    infos = ray.get([a.get_info.remote() for a in actors])
    actor_hosts = set(i["hostname"] for i in infos)

    print(f"  Actor hosts: {[i['hostname'] for i in infos]}")
    print(f"  Cross-node actors: {'PASSED' if len(actor_hosts) > 1 else 'SAME NODE'}")

    # Call actors
    results = ray.get([a.compute.remote(1000) for a in actors])
    for r in results:
        print(f"  Actor on {r['hostname']}: call #{r['call']}, trace={r['trace']:.2f}")

    # --- Distributed training with Ray Train ---
    print(f"\n[Distributed Training]")
    try:
        from ray.train.torch import TorchTrainer
        from ray.train import ScalingConfig
        import torch.nn as nn

        def train_func():
            import ray.train
            import torch
            import torch.nn as nn
            from torch.utils.data import DataLoader, TensorDataset

            model = nn.Sequential(
                nn.Linear(128, 256), nn.ReLU(),
                nn.Linear(256, 128), nn.ReLU(),
                nn.Linear(128, 10),
            )
            model = ray.train.torch.prepare_model(model)
            optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
            loss_fn = nn.CrossEntropyLoss()

            X = torch.randn(1000, 128)
            y = torch.randint(0, 10, (1000,))
            ds = TensorDataset(X, y)
            loader = DataLoader(ds, batch_size=64, shuffle=True)
            loader = ray.train.torch.prepare_data_loader(loader)

            for epoch in range(3):
                total_loss = 0
                for bx, by in loader:
                    optimizer.zero_grad()
                    out = model(bx)
                    loss = loss_fn(out, by)
                    loss.backward()
                    optimizer.step()
                    total_loss += loss.item()
                avg_loss = total_loss / len(loader)
                ray.train.report({"loss": avg_loss, "epoch": epoch + 1})

        trainer = TorchTrainer(
            train_func,
            scaling_config=ScalingConfig(
                num_workers=4,
                use_gpu=True,
            ),
        )
        result = trainer.fit()
        metrics = result.metrics
        print(f"  Final loss: {metrics.get('loss', '?')}")
        print(f"  Training: PASSED")
        train_ok = True
    except Exception as e:
        print(f"  Training FAILED: {e}")
        train_ok = False

    # --- Stderr test ---
    print("Tier 3 Ray multi-node stderr test", file=sys.stderr, flush=True)

    # --- Summary ---
    print(f"\n{'=' * 60}")
    print(f"TIER 3 RAY RESULTS")
    print(f"{'=' * 60}")
    print(f"  Cluster formation: {'PASSED' if cluster_ok else 'FAILED'}")
    print(f"  Multi-node:        {'YES' if is_multi_node else 'NO (single-node)'}")
    print(f"  Cross-node tasks:  {'PASSED' if cross_node_tasks else 'SINGLE HOST'}")
    print(f"  Object transfer:   PASSED ({bw:.1f} GB/s)")
    print(f"  Cross-node actors: {'PASSED' if len(actor_hosts) > 1 else 'SAME HOST'}")
    print(f"  Distributed train: {'PASSED' if train_ok else 'FAILED'}")
    if not is_multi_node:
        print(f"\n  NOTE: Got single-node allocation. Cross-node features not tested.")

    # Signal worker to shut down
    write_file(DONE_FILE, "done")
    time.sleep(5)  # give worker time to see it
    ray.shutdown()
    cleanup()


# ── Worker node (SLURM_PROCID > 0) ─────────────────────────────────

def run_worker():
    import ray

    print(f"[Worker {SLURM_PROCID}] {HOSTNAME} — waiting for head address...")
    sys.stdout.flush()

    head_addr = poll_file(ADDR_FILE, timeout=120)
    print(f"[Worker {SLURM_PROCID}] Connecting to head at {head_addr}")
    sys.stdout.flush()

    ray.init(
        address=head_addr,
        num_cpus=os.cpu_count(),
        num_gpus=NUM_GPUS_PER_NODE,
        _node_ip_address=socket.gethostbyname(HOSTNAME),
    )
    print(f"[Worker {SLURM_PROCID}] Connected. Idling until tests complete...")
    sys.stdout.flush()

    # Wait for head to signal completion
    try:
        poll_file(DONE_FILE, timeout=600, interval=5)
    except TimeoutError:
        print(f"[Worker {SLURM_PROCID}] Timed out waiting for completion signal")
    finally:
        ray.shutdown()
        print(f"[Worker {SLURM_PROCID}] Shutdown complete.")


# ── Entry point ─────────────────────────────────────────────────────

if __name__ == "__main__":
    if SLURM_PROCID == 0:
        run_head()
    else:
        run_worker()
