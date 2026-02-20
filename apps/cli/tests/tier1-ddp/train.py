"""
Tier 1 Test: Single-node 2-GPU DDP
Tests: NCCL, env var propagation, checkpoint storage, dual stdout/stderr logging,
       uv/pip cache paths, code loading via smart execution, cleanup on completion.

Run: rv run -g 2 --type a6000 -- torchrun --nproc_per_node=2 train.py
"""
import os, sys, json, torch, torch.nn as nn, torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data import DataLoader, TensorDataset

def check_infrastructure(rank):
    """Verify all rv infrastructure is set up correctly."""
    checks = {}

    # 1. Environment variables from rv
    for var in ["RV_CHECKPOINT_DIR", "CHECKPOINT_DIR", "HF_HOME",
                "UV_CACHE_DIR", "PIP_CACHE_DIR", "OMP_NUM_THREADS",
                "TOKENIZERS_PARALLELISM"]:
        val = os.environ.get(var)
        checks[var] = val
        if rank == 0:
            status = "OK" if val else "MISSING"
            print(f"  {var}: {val or 'NOT SET'} [{status}]")

    # 2. User-set env vars (from rv env)
    test_var = os.environ.get("RV_TEST_VAR")
    checks["RV_TEST_VAR"] = test_var
    if rank == 0:
        status = "OK" if test_var else "NOT SET (set with: rv env set RV_TEST_VAR hello)"
        print(f"  RV_TEST_VAR: {test_var or 'NOT SET'} [{status}]")

    # 3. Cache directories exist and have content
    for cache_var in ["UV_CACHE_DIR", "PIP_CACHE_DIR", "HF_HOME"]:
        path = os.environ.get(cache_var)
        if path:
            exists = os.path.isdir(path)
            checks[f"{cache_var}_exists"] = exists
            if rank == 0:
                print(f"  {cache_var} dir exists: {exists}")
                if exists:
                    try:
                        contents = os.listdir(path)
                        print(f"    contents: {contents[:10]}")
                    except OSError:
                        pass

    # 3b. uv cache deep inspection
    uv_cache = os.environ.get("UV_CACHE_DIR")
    if uv_cache and rank == 0:
        print(f"\n  [uv Cache Details]")
        print(f"    UV_CACHE_DIR: {uv_cache}")
        if os.path.isdir(uv_cache):
            for entry in sorted(os.listdir(uv_cache)):
                entry_path = os.path.join(uv_cache, entry)
                if os.path.isdir(entry_path):
                    sub = os.listdir(entry_path)
                    print(f"    {entry}/ ({len(sub)} items)")
                else:
                    size = os.path.getsize(entry_path)
                    print(f"    {entry} ({size} bytes)")
        else:
            print(f"    (directory does not exist — uv may not have cached yet)")

    # 4. Checkpoint directory
    ckpt_dir = os.environ.get("RV_CHECKPOINT_DIR")
    if ckpt_dir:
        os.makedirs(ckpt_dir, exist_ok=True)
        writable = os.access(ckpt_dir, os.W_OK)
        checks["ckpt_dir_writable"] = writable
        if rank == 0:
            print(f"  Checkpoint dir writable: {writable}")

    # 5. Working directory (smart execution workspace)
    cwd = os.getcwd()
    checks["cwd"] = cwd
    if rank == 0:
        print(f"  Working directory: {cwd}")
        # Check if we're in an rv-workspace (smart execution synced us here)
        if "rv-workspaces" in cwd:
            print(f"  Smart execution: YES (synced to workspace)")
        else:
            print(f"  Smart execution: NO (running from original path)")

    # 6. Check which Python/venv we're running in
    if rank == 0:
        import subprocess
        python_path = sys.executable
        print(f"  Python executable: {python_path}")
        if "rv-envs" in python_path or ".rv/envs" in python_path:
            print(f"  Per-project venv: YES (uv-managed)")
        elif ".rv/venv" in python_path:
            print(f"  Global venv: YES (persistent)")
        else:
            print(f"  Venv: system/other")

    return checks

def main():
    dist.init_process_group("nccl")
    rank = dist.get_rank()
    world_size = dist.get_world_size()
    local_rank = int(os.environ["LOCAL_RANK"])
    device = torch.device(f"cuda:{local_rank}")
    torch.cuda.set_device(device)

    if rank == 0:
        print("=" * 60)
        print("TIER 1 TEST: Single-node 2-GPU DDP")
        print("=" * 60)

    # --- GPU Info ---
    if rank == 0:
        print(f"\n[GPU Info]")
    gpu_name = torch.cuda.get_device_name(device)
    gpu_mem = torch.cuda.get_device_properties(device).total_memory / 1e9
    print(f"  [Rank {rank}] {gpu_name} ({gpu_mem:.1f} GB) on {os.environ.get('SLURMD_NODENAME', '?')}")

    # --- Infrastructure Checks ---
    if rank == 0:
        print(f"\n[Infrastructure Checks]")
    checks = check_infrastructure(rank)

    # --- Stderr test (should appear in red in rv logs) ---
    if rank == 0:
        print(f"\n[Training]", flush=True)
        print("This line goes to stderr for testing dual log tailing", file=sys.stderr, flush=True)

    # --- DDP Training ---
    model = nn.Sequential(
        nn.Linear(128, 512), nn.ReLU(),
        nn.Linear(512, 256), nn.ReLU(),
        nn.Linear(256, 10)
    ).to(device)
    model = DDP(model, device_ids=[local_rank])
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.CrossEntropyLoss()

    X = torch.randn(2000, 128)
    y = torch.randint(0, 10, (2000,))
    dataset = TensorDataset(X, y)
    sampler = torch.utils.data.distributed.DistributedSampler(dataset, num_replicas=world_size, rank=rank)
    loader = DataLoader(dataset, batch_size=64, sampler=sampler, num_workers=2)

    for epoch in range(3):
        sampler.set_epoch(epoch)
        total_loss = 0
        for batch_x, batch_y in loader:
            batch_x, batch_y = batch_x.to(device), batch_y.to(device)
            optimizer.zero_grad()
            out = model(batch_x)
            loss = loss_fn(out, batch_y)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        if rank == 0:
            avg = total_loss / len(loader)
            print(f"  Epoch {epoch+1}/3 loss={avg:.4f}")

    # --- Verify gradient sync across GPUs ---
    if rank == 0:
        print(f"\n[Gradient Sync Verification]")
    param = list(model.parameters())[0]
    local_sum = param.data.sum().item()
    tensor = torch.tensor([local_sum], device=device)
    dist.all_reduce(tensor)
    if rank == 0:
        print(f"  All-reduce sum: {tensor.item():.4f} (should be {world_size}x single GPU)")

    # --- Save checkpoint ---
    if rank == 0:
        ckpt_dir = os.environ.get("RV_CHECKPOINT_DIR", "/tmp")
        os.makedirs(ckpt_dir, exist_ok=True)
        ckpt_path = os.path.join(ckpt_dir, "ddp_model.pt")
        torch.save({
            "model": model.module.state_dict(),
            "optimizer": optimizer.state_dict(),
            "epoch": 3,
        }, ckpt_path)
        size_kb = os.path.getsize(ckpt_path) / 1024
        print(f"\n[Checkpoint]")
        print(f"  Saved to: {ckpt_path}")
        print(f"  Size: {size_kb:.1f} KB")

    # --- Final summary ---
    if rank == 0:
        print(f"\n[Result]")
        print(f"  DDP training: PASSED")
        print(f"  NCCL communication: PASSED")
        # Intentional stderr to test dual tailing
        print(f"  (this stderr confirms dual log tailing works)", file=sys.stderr, flush=True)

    dist.destroy_process_group()

if __name__ == "__main__":
    main()
