"""Quick test job: Ray dashboard + GPU + stdout/stderr."""
import sys, os, time

print("=== rv test job starting ===", flush=True)
print(f"PID: {os.getpid()}", flush=True)
print(f"Host: {os.uname().nodename}", flush=True)

# stderr output
print("Loading CUDA...", file=sys.stderr, flush=True)

import torch
print(f"\nPyTorch {torch.__version__}", flush=True)
print(f"CUDA available: {torch.cuda.is_available()}", flush=True)
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}", flush=True)
    props = torch.cuda.get_device_properties(0)
    print(f"VRAM: {props.total_memory / 1e9:.1f} GB", flush=True)

    x = torch.randn(4096, 4096, device="cuda")
    t0 = time.time()
    for _ in range(10):
        y = x @ x
    torch.cuda.synchronize()
    print(f"10x matmul (4096x4096): {time.time() - t0:.3f}s", flush=True)
else:
    print("WARNING: No CUDA device!", file=sys.stderr, flush=True)

# Ray
print("\nStarting Ray...", flush=True)
print("Initializing Ray cluster...", file=sys.stderr, flush=True)

import ray
ray.init(dashboard_host="0.0.0.0", dashboard_port=8265)
print(f"Ray dashboard: http://localhost:8265", flush=True)
print(f"Resources: {ray.cluster_resources()}", flush=True)

@ray.remote(num_gpus=0.25)
def gpu_task(i):
    import torch
    x = torch.randn(2048, 2048, device="cuda")
    _ = x @ x
    torch.cuda.synchronize()
    return f"Task {i}: done on {torch.cuda.get_device_name(0)}"

print("\nRunning 8 Ray GPU tasks...", flush=True)
for result in ray.get([gpu_task.remote(i) for i in range(8)]):
    print(f"  {result}", flush=True)

print("\n=== Keeping alive 5 min (rv stop to end) ===", flush=True)
try:
    for i in range(300):
        if i % 30 == 0 and i > 0:
            print(f"  Alive ({i}s)...", flush=True)
        time.sleep(1)
except KeyboardInterrupt:
    pass

ray.shutdown()
print("Done.", flush=True)
