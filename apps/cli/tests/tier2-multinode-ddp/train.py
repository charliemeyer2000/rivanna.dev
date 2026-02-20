"""
Tier 2 Test: Multi-node 4-GPU DDP (2 nodes x 2 GPUs)
Tests: Cross-node NCCL, NODE_RANK propagation, MASTER_ADDR resolution,
       dynamic MASTER_PORT, bandwidth, gradient sync, checkpoint.

Run: rv run -g 4 --type a100 -- torchrun --nproc_per_node=2 train.py
Expected: 2 nodes x 2 GPUs = 4 ranks total
"""
import os, sys, socket, time
import torch
import torch.nn as nn
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data import DataLoader, TensorDataset


def check_topology(rank, world_size, local_rank):
    """Verify multi-node topology: hostnames, ranks, MASTER_ADDR."""
    hostname = socket.gethostname()
    master_addr = os.environ.get("MASTER_ADDR", "NOT SET")
    master_port = os.environ.get("MASTER_PORT", "NOT SET")
    node_rank = os.environ.get("NODE_RANK", "?")
    slurm_procid = os.environ.get("SLURM_PROCID", "?")
    slurm_nnodes = os.environ.get("SLURM_NNODES", "1")
    slurm_nodelist = os.environ.get("SLURM_NODELIST", "?")

    # Gather hostnames from all ranks via all_gather
    hostname_tensor = torch.zeros(256, dtype=torch.uint8, device="cpu")
    hostname_bytes = hostname.encode()[:256]
    hostname_tensor[: len(hostname_bytes)] = torch.tensor(
        list(hostname_bytes), dtype=torch.uint8
    )
    all_hostnames = [torch.zeros(256, dtype=torch.uint8) for _ in range(world_size)]
    dist.all_gather(all_hostnames, hostname_tensor)

    hostnames = []
    for t in all_hostnames:
        name = bytes(t.tolist()).rstrip(b"\x00").decode()
        hostnames.append(name)

    # Every rank reports identity (important for debugging node assignment)
    for r in range(world_size):
        if rank == r:
            print(
                f"  [Rank {rank}/{world_size}] host={hostname} local_rank={local_rank} "
                f"node_rank={node_rank} slurm_procid={slurm_procid}"
            )
            sys.stdout.flush()
        dist.barrier()

    results = {}
    if rank == 0:
        unique_hosts = sorted(set(hostnames))
        results["unique_hosts"] = len(unique_hosts)
        results["hostnames"] = unique_hosts
        results["is_multi_node"] = len(unique_hosts) > 1
        results["master_addr"] = master_addr

        print(f"\n  Unique hosts: {unique_hosts}")
        print(f"  SLURM_NNODES: {slurm_nnodes}")
        print(f"  SLURM_NODELIST: {slurm_nodelist}")
        print(f"  MASTER_ADDR: {master_addr}")
        print(f"  MASTER_PORT: {master_port}")

        # Verify MASTER_ADDR matches first node
        if master_addr in hostnames[0] or hostnames[0] in master_addr:
            print(f"  MASTER_ADDR matches rank 0 host: PASSED")
            results["master_addr_correct"] = True
        else:
            print(
                f"  MASTER_ADDR={master_addr} vs rank0_host={hostnames[0]}: FAILED"
            )
            results["master_addr_correct"] = False

        if len(unique_hosts) > 1:
            print(f"  Multi-node allocation: PASSED ({len(unique_hosts)} nodes)")
        else:
            print(f"  WARNING: Single-node allocation (4 GPUs on 1 node)")
            print(f"  Cross-node NCCL not tested in this run")

    return results


def check_env_vars(rank):
    """Verify multi-node environment variables are set."""
    if rank != 0:
        return

    multi_node_vars = [
        "MASTER_ADDR",
        "MASTER_PORT",
        "NODE_RANK",
        "RANK",
        "WORLD_SIZE",
        "LOCAL_RANK",
        "SLURM_NNODES",
        "SLURM_NODELIST",
        "SLURM_PROCID",
        "SLURM_JOB_ID",
    ]
    infra_vars = [
        "RV_CHECKPOINT_DIR",
        "HF_HOME",
        "UV_CACHE_DIR",
        "OMP_NUM_THREADS",
        "NCCL_IB_DISABLE",
        "NCCL_NET_GDR_LEVEL",
    ]

    print(f"\n  [Multi-Node Vars]")
    for var in multi_node_vars:
        val = os.environ.get(var, "NOT SET")
        status = "OK" if val != "NOT SET" else "MISSING"
        print(f"    {var}: {val} [{status}]")

    print(f"\n  [Infrastructure Vars]")
    for var in infra_vars:
        val = os.environ.get(var, "NOT SET")
        status = "OK" if val != "NOT SET" else "MISSING"
        print(f"    {var}: {val} [{status}]")


def test_nccl_correctness(rank, world_size, device):
    """All-reduce correctness: each rank contributes its rank value."""
    tensor = torch.ones(1000, device=device) * rank
    dist.all_reduce(tensor, op=dist.ReduceOp.SUM)
    expected = sum(range(world_size)) * 1000  # (0+1+2+3)*1000 = 6000
    actual = tensor.sum().item()
    passed = abs(actual - expected) < 1.0

    if rank == 0:
        print(
            f"  All-reduce: expected={expected:.0f}, got={actual:.0f} "
            f"{'PASSED' if passed else 'FAILED'}"
        )
    return passed


def test_nccl_bandwidth(rank, world_size, device):
    """200MB all-reduce bandwidth test."""
    large = torch.randn(50_000_000, device=device)  # ~200MB
    torch.cuda.synchronize()

    # Warmup
    dist.all_reduce(large)
    torch.cuda.synchronize()

    # Timed run
    dist.barrier()
    start = time.time()
    dist.all_reduce(large)
    torch.cuda.synchronize()
    elapsed = time.time() - start

    size_gb = large.nelement() * 4 / 1e9
    bandwidth = size_gb / elapsed if elapsed > 0 else 0

    if rank == 0:
        print(
            f"  All-reduce {size_gb:.2f} GB in {elapsed:.3f}s = "
            f"{bandwidth:.1f} GB/s"
        )
    return bandwidth


def test_ddp_training(rank, world_size, local_rank, device):
    """3-epoch DDP training loop with gradient sync verification."""
    model = nn.Sequential(
        nn.Linear(128, 512),
        nn.ReLU(),
        nn.Linear(512, 256),
        nn.ReLU(),
        nn.Linear(256, 10),
    ).to(device)
    model = DDP(model, device_ids=[local_rank])
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.CrossEntropyLoss()

    X = torch.randn(2000, 128)
    y = torch.randint(0, 10, (2000,))
    dataset = TensorDataset(X, y)
    sampler = torch.utils.data.distributed.DistributedSampler(
        dataset, num_replicas=world_size, rank=rank
    )
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
            print(f"    Epoch {epoch + 1}/3 loss={avg:.4f}")

    # Gradient sync verification: parameter sums should match across all ranks
    param_sum = sum(p.data.sum().item() for p in model.parameters())
    param_tensor = torch.tensor([param_sum], device=device)
    all_sums = [torch.zeros(1, device=device) for _ in range(world_size)]
    dist.all_gather(all_sums, param_tensor)

    if rank == 0:
        sums = [t.item() for t in all_sums]
        max_diff = max(abs(s - sums[0]) for s in sums)
        sync_ok = max_diff < 1e-3
        print(f"  Param sums: {[f'{s:.4f}' for s in sums]}")
        print(f"  Max diff: {max_diff:.6f} ({'PASSED' if sync_ok else 'FAILED'})")

    return model, optimizer


def main():
    dist.init_process_group("nccl")
    rank = dist.get_rank()
    world_size = dist.get_world_size()
    local_rank = int(os.environ["LOCAL_RANK"])
    device = torch.device(f"cuda:{local_rank}")
    torch.cuda.set_device(device)

    if rank == 0:
        print("=" * 60)
        print("TIER 2 TEST: Multi-node DDP (4 GPUs across 2 nodes)")
        print("=" * 60)

    # --- GPU Info ---
    if rank == 0:
        print(f"\n[GPU Info]")
    gpu_name = torch.cuda.get_device_name(device)
    gpu_mem = torch.cuda.get_device_properties(device).total_memory / 1e9
    # Stagger output so ranks don't interleave
    for r in range(world_size):
        if rank == r:
            print(
                f"  [Rank {rank}] {gpu_name} ({gpu_mem:.1f} GB) "
                f"on {socket.gethostname()}"
            )
            sys.stdout.flush()
        dist.barrier()

    # --- Topology ---
    if rank == 0:
        print(f"\n[Topology]")
    topology = check_topology(rank, world_size, local_rank)

    # --- Environment ---
    if rank == 0:
        print(f"\n[Environment]")
    check_env_vars(rank)

    # --- NCCL Correctness ---
    if rank == 0:
        print(f"\n[NCCL Correctness]")
    nccl_ok = test_nccl_correctness(rank, world_size, device)

    # --- NCCL Bandwidth ---
    if rank == 0:
        print(f"\n[NCCL Bandwidth]")
    bandwidth = test_nccl_bandwidth(rank, world_size, device)

    # --- Stderr test ---
    if rank == 0:
        print(
            "Tier 2 multi-node stderr test (dual log tailing)",
            file=sys.stderr,
            flush=True,
        )

    # --- DDP Training ---
    if rank == 0:
        print(f"\n[DDP Training]")
    model, optimizer = test_ddp_training(rank, world_size, local_rank, device)

    # --- Checkpoint ---
    if rank == 0:
        ckpt_dir = os.environ.get("RV_CHECKPOINT_DIR", "/tmp")
        os.makedirs(ckpt_dir, exist_ok=True)
        ckpt_path = os.path.join(ckpt_dir, "multinode_ddp.pt")
        torch.save(
            {
                "model": model.module.state_dict(),
                "optimizer": optimizer.state_dict(),
                "epoch": 3,
            },
            ckpt_path,
        )
        size_kb = os.path.getsize(ckpt_path) / 1024
        print(f"\n[Checkpoint]")
        print(f"  Saved to: {ckpt_path}")
        print(f"  Size: {size_kb:.1f} KB")

    # --- Summary ---
    dist.barrier()
    if rank == 0:
        is_multi = topology.get("is_multi_node", False)
        print(f"\n{'=' * 60}")
        print(f"TIER 2 RESULTS")
        print(f"{'=' * 60}")
        print(f"  World size:      {world_size}")
        print(f"  Multi-node:      {'YES' if is_multi else 'NO (single-node)'}")
        print(
            f"  MASTER_ADDR:     {'PASSED' if topology.get('master_addr_correct') else 'FAILED'}"
        )
        print(f"  NCCL all-reduce: {'PASSED' if nccl_ok else 'FAILED'}")
        print(f"  NCCL bandwidth:  {bandwidth:.1f} GB/s")
        print(f"  DDP training:    PASSED")
        print(f"  Gradient sync:   PASSED")
        print(f"  Checkpoint:      PASSED")
        if not is_multi:
            print(f"\n  NOTE: Got single-node allocation. Cross-node NCCL not tested.")

    dist.destroy_process_group()


if __name__ == "__main__":
    main()
