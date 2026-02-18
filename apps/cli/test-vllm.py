"""vLLM stress test: serve a small LLM on 1 GPU with OpenAI-compatible API."""
import os, sys, time, subprocess

def main():
    print("=== vLLM stress test ===", flush=True)
    print(f"Host: {os.uname().nodename}", flush=True)
    print(f"PID: {os.getpid()}", flush=True)

    # Show env vars injected by rv env
    model = os.environ.get("MODEL_NAME", "Qwen/Qwen2.5-0.5B-Instruct")
    print(f"\nMODEL_NAME={model}", flush=True)
    print(f"HF_HOME={os.environ.get('HF_HOME', 'not set')}", flush=True)

    # CUDA check
    print("\nChecking CUDA...", file=sys.stderr, flush=True)
    import torch
    print(f"PyTorch {torch.__version__}", flush=True)
    print(f"CUDA: {torch.cuda.is_available()}", flush=True)
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name(0)}", flush=True)
        print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB", flush=True)

    # Test offline inference first (with spawn guard)
    print(f"\nLoading {model} for offline test...", flush=True)
    from vllm import LLM, SamplingParams

    llm = LLM(
        model=model,
        trust_remote_code=True,
        gpu_memory_utilization=0.8,
        max_model_len=2048,
    )

    print("Model loaded! Running test inference...", flush=True)
    params = SamplingParams(temperature=0.7, max_tokens=100)
    prompts = [
        "Write a haiku about GPU computing:",
        "Explain CUDA in one sentence:",
        "What is the meaning of life? Answer briefly:",
    ]

    outputs = llm.generate(prompts, params)
    for output in outputs:
        text = output.outputs[0].text.strip()
        print(f"\n  Prompt: {output.prompt}", flush=True)
        print(f"  Output: {text}", flush=True)

    # Clean up LLM to free GPU memory for the server
    del llm
    import gc; gc.collect()
    torch.cuda.empty_cache()

    # Start the OpenAI-compatible API server
    print("\n\nStarting OpenAI-compatible API server on port 8000...", flush=True)
    server = subprocess.Popen(
        [
            sys.executable, "-m", "vllm.entrypoints.openai.api_server",
            "--model", model,
            "--host", "0.0.0.0",
            "--port", "8000",
            "--gpu-memory-utilization", "0.9",
            "--max-model-len", "2048",
        ],
        stdout=sys.stdout,
        stderr=sys.stderr,
    )

    print(f"\nvLLM API server started (PID {server.pid})", flush=True)
    print("  http://localhost:8000/v1/models", flush=True)
    print("  http://localhost:8000/v1/chat/completions", flush=True)

    print("\n=== Server running. Use rv forward 8000 to access. rv stop to end. ===", flush=True)
    try:
        server.wait()
    except KeyboardInterrupt:
        server.terminate()
        server.wait()
        print("\nServer stopped.", flush=True)


if __name__ == "__main__":
    main()
