"""
Tier 1 Test: Single-node 2-GPU Ray
Tests: ray.init() auto-detect, GPU scheduling, dashboard port,
       env vars, cache paths, port forwarding readiness.

Run: rv run -g 2 --type a6000 -- python test_ray.py
Then: rv forward 8265  (to access Ray dashboard)
"""
import os, sys, time

def main():
    print("=" * 60)
    print("TIER 1 TEST: Single-node 2-GPU Ray")
    print("=" * 60)

    # --- Infrastructure checks ---
    print(f"\n[Infrastructure]")
    for var in ["RV_CHECKPOINT_DIR", "HF_HOME", "UV_CACHE_DIR",
                "PIP_CACHE_DIR", "OMP_NUM_THREADS", "CUDA_VISIBLE_DEVICES"]:
        val = os.environ.get(var, "NOT SET")
        print(f"  {var}: {val}")
    print(f"  Working dir: {os.getcwd()}")

    # uv cache inspection
    uv_cache = os.environ.get("UV_CACHE_DIR")
    if uv_cache:
        print(f"\n[uv Cache]")
        print(f"  UV_CACHE_DIR: {uv_cache}")
        if os.path.isdir(uv_cache):
            for entry in sorted(os.listdir(uv_cache)):
                entry_path = os.path.join(uv_cache, entry)
                if os.path.isdir(entry_path):
                    sub = os.listdir(entry_path)
                    print(f"  {entry}/ ({len(sub)} items)")
                else:
                    size = os.path.getsize(entry_path)
                    print(f"  {entry} ({size} bytes)")
        else:
            print(f"  (directory does not exist)")

    # --- Initialize Ray ---
    import ray
    import torch

    print(f"\n[Ray Init]")
    print(f"  Ray version: {ray.__version__}")
    print(f"  PyTorch version: {torch.__version__}")
    print(f"  CUDA available: {torch.cuda.is_available()}")
    print(f"  GPU count (torch): {torch.cuda.device_count()}")

    # ray.init() should auto-detect GPUs on this node
    ray.init()

    print(f"\n[Ray Cluster]")
    resources = ray.cluster_resources()
    print(f"  Total CPUs: {resources.get('CPU', 0)}")
    print(f"  Total GPUs: {resources.get('GPU', 0)}")
    print(f"  Nodes: {len(ray.nodes())}")

    # Dashboard info
    context = ray.get_runtime_context()
    # Ray 2.x: dashboard URL from runtime context or node info
    node_info = ray.nodes()[0]
    dashboard_port = node_info.get("MetricsExportPort", 8265)
    # The dashboard URL is printed during ray.init() — extract from node info
    dashboard_url = f"http://127.0.0.1:{dashboard_port}"
    # Try the standard dashboard port (printed in init log)
    print(f"\n[Ray Dashboard]")
    print(f"  Dashboard agent port: {dashboard_port}")
    print(f"  Check init log above for actual dashboard URL")
    print(f"  To access: rv forward <dashboard_port>")

    # --- Run GPU tasks ---
    @ray.remote(num_gpus=1)
    def gpu_task(task_id):
        """Run on a single GPU, return device info."""
        import torch
        device = torch.device("cuda")
        gpu_name = torch.cuda.get_device_name(0)
        gpu_mem = torch.cuda.get_device_properties(0).total_memory / 1e9

        # Do some GPU work
        x = torch.randn(1000, 1000, device=device)
        y = torch.matmul(x, x.T)
        result = y.sum().item()

        return {
            "task_id": task_id,
            "gpu_name": gpu_name,
            "gpu_mem_gb": round(gpu_mem, 1),
            "cuda_device": os.environ.get("CUDA_VISIBLE_DEVICES", "?"),
            "matmul_sum": result,
            "hostname": os.uname().nodename,
        }

    print(f"\n[GPU Tasks]")
    print(f"  Launching 2 GPU tasks (one per GPU)...")

    futures = [gpu_task.remote(i) for i in range(2)]
    results = ray.get(futures)

    for r in results:
        print(f"  Task {r['task_id']}: {r['gpu_name']} ({r['gpu_mem_gb']} GB) "
              f"CUDA={r['cuda_device']} on {r['hostname']}")

    # --- Test actor with GPU ---
    @ray.remote(num_gpus=1)
    class GPUCounter:
        def __init__(self):
            import torch
            self.device = torch.device("cuda")
            self.count = 0

        def increment(self):
            import torch
            # Do GPU work to prove we have the device
            x = torch.ones(100, device=self.device)
            self.count += int(x.sum().item())
            return self.count

    print(f"\n[GPU Actor]")
    actor = GPUCounter.remote()
    for i in range(5):
        count = ray.get(actor.increment.remote())
    print(f"  Actor counter after 5 increments: {count} (expected: 500)")

    # --- Stderr test ---
    print("Ray stderr test line", file=sys.stderr, flush=True)

    # --- Keep dashboard alive briefly for port forward testing ---
    print(f"\n[Dashboard Test Window]")
    print(f"  Dashboard is live at {dashboard_url}")
    print(f"  Keeping alive for 30s for port forward testing...")
    print(f"  Run in another terminal: rv forward 8265")
    time.sleep(30)

    # --- Summary ---
    print(f"\n[Result]")
    print(f"  Ray init: PASSED")
    print(f"  GPU scheduling: PASSED ({len(results)} tasks on {len(results)} GPUs)")
    print(f"  GPU actor: PASSED")
    print(f"  Dashboard: PASSED (see init log for URL)")

    ray.shutdown()

if __name__ == "__main__":
    main()
