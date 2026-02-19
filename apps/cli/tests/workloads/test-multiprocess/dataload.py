import os, time, torch, multiprocessing as mp
from torch.utils.data import DataLoader, Dataset

class SyntheticDataset(Dataset):
    def __init__(self, size=10000):
        self.size = size
    def __len__(self):
        return self.size
    def __getitem__(self, idx):
        return torch.randn(3, 224, 224), torch.randint(0, 1000, (1,)).item()

def square(x):
    return x * x

def main():
    cpus = os.cpu_count()
    slurm_cpus = os.environ.get("SLURM_CPUS_PER_TASK", "?")
    omp_threads = os.environ.get("OMP_NUM_THREADS", "not set")
    print(f"CPUs visible: {cpus}, SLURM_CPUS_PER_TASK: {slurm_cpus}, OMP_NUM_THREADS: {omp_threads}")

    ds = SyntheticDataset(1000)
    for num_workers in [0, 2, 4, 8]:
        try:
            loader = DataLoader(ds, batch_size=32, num_workers=num_workers, pin_memory=True)
            start = time.time()
            for batch in loader:
                pass
            elapsed = time.time() - start
            print(f"num_workers={num_workers}: {elapsed:.2f}s for 1000 samples")
        except Exception as e:
            print(f"num_workers={num_workers}: FAILED - {e}")

    with mp.Pool(min(4, cpus or 1)) as pool:
        result = pool.map(square, range(100))
        print(f"mp.Pool(4): sum of squares = {sum(result)}")

if __name__ == "__main__":
    main()
