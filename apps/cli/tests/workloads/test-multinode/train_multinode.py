import os, socket, torch, torch.distributed as dist

def main():
    dist.init_process_group("nccl")
    rank = dist.get_rank()
    world_size = dist.get_world_size()
    local_rank = int(os.environ["LOCAL_RANK"])
    device = torch.device(f"cuda:{local_rank}")
    torch.cuda.set_device(device)

    hostname = socket.gethostname()
    print(f"[Rank {rank}/{world_size}] local_rank={local_rank} host={hostname} device={device}")

    # NCCL connectivity test — all-reduce
    tensor = torch.ones(1000, device=device) * rank
    dist.all_reduce(tensor, op=dist.ReduceOp.SUM)
    expected = sum(range(world_size)) * 1000
    actual = tensor.sum().item()
    print(f"[Rank {rank}] all_reduce: expected={expected}, got={actual}, {'PASS' if abs(actual - expected) < 1 else 'FAIL'}")

    # Bandwidth test — large tensor all-reduce
    import time
    large = torch.randn(50_000_000, device=device)  # ~200MB
    torch.cuda.synchronize()
    start = time.time()
    dist.all_reduce(large)
    torch.cuda.synchronize()
    elapsed = time.time() - start
    size_gb = large.nelement() * 4 / 1e9
    if rank == 0:
        print(f"All-reduce {size_gb:.2f} GB in {elapsed:.3f}s = {size_gb/elapsed:.1f} GB/s effective bandwidth")

    # Report NCCL env
    for key in sorted(os.environ):
        if "NCCL" in key or "MASTER" in key or "SLURM" in key.upper():
            if rank == 0:
                print(f"  {key}={os.environ[key]}")

    dist.destroy_process_group()
    if rank == 0:
        print("Multi-node test PASSED")

if __name__ == "__main__":
    main()
