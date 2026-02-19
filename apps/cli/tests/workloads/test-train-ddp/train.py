import os, torch, torch.nn as nn, torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data import DataLoader, TensorDataset

def main():
    dist.init_process_group("nccl")
    rank = dist.get_rank()
    world_size = dist.get_world_size()
    local_rank = int(os.environ["LOCAL_RANK"])
    device = torch.device(f"cuda:{local_rank}")
    torch.cuda.set_device(device)

    print(f"[Rank {rank}/{world_size}] on {device}, node={os.environ.get('SLURMD_NODENAME','?')}")

    # Simple model
    model = nn.Sequential(nn.Linear(128, 256), nn.ReLU(), nn.Linear(256, 10)).to(device)
    model = DDP(model, device_ids=[local_rank])
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.CrossEntropyLoss()

    # Synthetic data
    X = torch.randn(1000, 128)
    y = torch.randint(0, 10, (1000,))
    dataset = TensorDataset(X, y)
    sampler = torch.utils.data.distributed.DistributedSampler(dataset, num_replicas=world_size, rank=rank)
    loader = DataLoader(dataset, batch_size=32, sampler=sampler)

    # Train 5 epochs
    for epoch in range(5):
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
            print(f"Epoch {epoch+1}/5 loss={total_loss/len(loader):.4f}")

    # Save checkpoint to RV_CHECKPOINT_DIR
    if rank == 0:
        ckpt_dir = os.environ.get("RV_CHECKPOINT_DIR", "/tmp")
        path = os.path.join(ckpt_dir, "model.pt")
        torch.save(model.module.state_dict(), path)
        print(f"Checkpoint saved to {path}")
        print(f"Checkpoint size: {os.path.getsize(path) / 1024:.1f} KB")

    dist.destroy_process_group()

if __name__ == "__main__":
    main()
