"""
rv GPU stress test — multi-GPU vLLM serving with Ray
Tests: CUDA detection, tensor parallelism, model serving, Ray dashboard
"""

import os
import sys
import json
import subprocess

def section(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")

def check_cuda():
    section("1. CUDA Detection")
    import torch

    if not torch.cuda.is_available():
        print("FATAL: CUDA not available")
        sys.exit(1)

    gpu_count = torch.cuda.device_count()
    print(f"CUDA available: True")
    print(f"GPU count: {gpu_count}")
    print(f"PyTorch version: {torch.__version__}")
    print(f"CUDA version: {torch.version.cuda}")

    for i in range(gpu_count):
        props = torch.cuda.get_device_properties(i)
        vram_gb = props.total_memory / (1024**3)
        print(f"\n  GPU {i}: {props.name}")
        print(f"    VRAM: {vram_gb:.1f} GB")
        print(f"    Compute capability: {props.major}.{props.minor}")

    if gpu_count < 2:
        print(f"\nWARNING: Only {gpu_count} GPU(s), tensor parallelism will use tp=1")

    return gpu_count

def check_model_cache():
    section("2. Model Cache")
    hf_home = os.environ.get("HF_HOME", "~/.cache/huggingface")
    hub_dir = os.path.join(os.path.expanduser(hf_home), "hub")

    print(f"HF_HOME: {hf_home}")
    print(f"Hub dir: {hub_dir}")

    if os.path.exists(hub_dir):
        models = [d for d in os.listdir(hub_dir) if d.startswith("models--")]
        print(f"Cached models: {len(models)}")
        for m in models:
            model_path = os.path.join(hub_dir, m)
            size = subprocess.run(
                ["du", "-sh", model_path],
                capture_output=True, text=True
            ).stdout.split()[0] if os.path.exists(model_path) else "?"
            print(f"  {m.replace('models--', '').replace('--', '/')}: {size}")
    else:
        print("No hub cache directory found")

def check_storage():
    section("3. Storage")
    result = subprocess.run(["hdquota"], capture_output=True, text=True)
    if result.returncode == 0:
        print(result.stdout.strip())
    else:
        print("hdquota not available")

def serve_model(gpu_count: int):
    section("4. vLLM Server (tensor parallel)")

    model = "Qwen/Qwen2.5-7B-Instruct"
    tp = min(gpu_count, 2)
    port = 8000

    print(f"Model: {model}")
    print(f"Tensor parallel: {tp}")
    print(f"API port: {port}")
    print(f"Ray dashboard: 8265")
    print()
    print(f"Forward ports:  rv forward {port} && rv forward 8265")
    print(f"Test API:       curl http://localhost:{port}/v1/models")
    print(f"Chat:           curl -s http://localhost:{port}/v1/chat/completions \\")
    print(f'                  -H "Content-Type: application/json" \\')
    print(f'                  -d \'{{"model": "{model}", "messages": [{{"role": "user", "content": "Hello"}}]}}\'')
    print()
    sys.stdout.flush()

    # vLLM 0.11.2 V1 multiproc executor has a race condition with TP>1
    # where the parent process exits before workers finish init.
    # Workaround: set VLLM_WORKER_MULTIPROC_METHOD=fork and reduce max-model-len.
    os.environ["VLLM_WORKER_MULTIPROC_METHOD"] = "fork"

    cmd = [
        sys.executable, "-m", "vllm.entrypoints.openai.api_server",
        "--model", model,
        "--tensor-parallel-size", str(tp),
        "--host", "0.0.0.0",
        "--port", str(port),
        "--trust-remote-code",
        "--max-model-len", "4096",
    ]

    # Use subprocess.run to keep parent process alive
    result = subprocess.run(cmd)
    sys.exit(result.returncode)

if __name__ == "__main__":
    print("rv GPU Stress Test")
    print(f"PID: {os.getpid()}")
    print(f"Node: {os.environ.get('SLURMD_NODENAME', 'unknown')}")
    print(f"Job ID: {os.environ.get('SLURM_JOB_ID', 'unknown')}")
    print(f"GPUs allocated: {os.environ.get('SLURM_GPUS_ON_NODE', os.environ.get('CUDA_VISIBLE_DEVICES', 'unknown'))}")

    gpu_count = check_cuda()
    check_model_cache()
    check_storage()
    serve_model(gpu_count)
