import torch, os, platform, sys
print(f"Python: {sys.version}")
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    # Quick matmul to verify compute works
    a = torch.randn(1000, 1000, device="cuda")
    b = torch.randn(1000, 1000, device="cuda")
    c = a @ b
    print(f"Matmul result shape: {c.shape}, sum: {c.sum().item():.2f}")
print(f"Node: {os.environ.get('SLURMD_NODENAME', platform.node())}")
print(f"Job ID: {os.environ.get('SLURM_JOB_ID', 'N/A')}")
print(f"Checkpoint dir: {os.environ.get('RV_CHECKPOINT_DIR', 'not set')}")
print(f"HF_HOME: {os.environ.get('HF_HOME', 'not set')}")
