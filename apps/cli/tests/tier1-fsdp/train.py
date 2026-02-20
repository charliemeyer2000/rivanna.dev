"""
Tier 1 Test: Single-node 2-GPU FSDP with HuggingFace model
Tests: FSDP sharding, HF model cache, HF_HOME path, checkpoint storage,
       env vars, smart execution, requirements install via uv.

Run: rv run -g 2 --type a6000 -- torchrun --nproc_per_node=2 train.py
"""
import os, sys, time, torch, torch.distributed as dist
from torch.distributed.fsdp import FullyShardedDataParallel as FSDP

def main():
    dist.init_process_group("nccl")
    rank = dist.get_rank()
    world_size = dist.get_world_size()
    local_rank = int(os.environ["LOCAL_RANK"])
    torch.cuda.set_device(local_rank)

    if rank == 0:
        print("=" * 60)
        print("TIER 1 TEST: Single-node 2-GPU FSDP + HuggingFace Cache")
        print("=" * 60)

    # --- Check HuggingFace cache ---
    hf_home = os.environ.get("HF_HOME")
    if rank == 0:
        print(f"\n[HuggingFace Cache]")
        print(f"  HF_HOME: {hf_home}")
        if hf_home:
            exists = os.path.isdir(hf_home)
            print(f"  Directory exists: {exists}")
            if exists:
                # Check if there are cached models
                hub_dir = os.path.join(hf_home, "hub")
                if os.path.isdir(hub_dir):
                    models = os.listdir(hub_dir)
                    print(f"  Cached models: {len(models)}")
                    for m in models[:5]:
                        print(f"    {m}")
                else:
                    print(f"  Hub dir not yet created (first download)")

    # --- Check other infrastructure ---
    if rank == 0:
        print(f"\n[Infrastructure]")
        for var in ["RV_CHECKPOINT_DIR", "UV_CACHE_DIR", "PIP_CACHE_DIR",
                     "OMP_NUM_THREADS", "TOKENIZERS_PARALLELISM"]:
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

    # --- Download + load a small HF model (tests cache) ---
    # Use sshleifer/tiny-gpt2 — only ~500KB, instant download
    from transformers import AutoModelForCausalLM, AutoTokenizer

    model_name = "sshleifer/tiny-gpt2"
    if rank == 0:
        print(f"\n[Model Loading]")
        print(f"  Loading {model_name}...")
        t0 = time.time()

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(model_name, torch_dtype=torch.float32)

    if rank == 0:
        dt = time.time() - t0
        params = sum(p.numel() for p in model.parameters()) / 1e6
        print(f"  Loaded in {dt:.1f}s ({params:.1f}M params)")

        # Verify model is cached
        hub_dir = os.path.join(hf_home or "~/.cache/huggingface", "hub")
        if os.path.isdir(hub_dir):
            print(f"  Cache dir contents after download:")
            for item in os.listdir(hub_dir):
                if "tiny" in item.lower() or "gpt2" in item.lower():
                    print(f"    {item} (CACHED)")

    # --- Wrap with FSDP ---
    if rank == 0:
        print(f"\n[FSDP Wrapping]")

    model = FSDP(model, device_id=local_rank)

    if rank == 0:
        print(f"  FSDP wrapped successfully")
        # Check sharding
        for name, param in model.named_parameters():
            if param.is_meta:
                print(f"  Param {name}: SHARDED (meta)")
            break

    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-5)

    # --- Training loop ---
    if rank == 0:
        print(f"\n[FSDP Training]")

    texts = ["The quick brown fox jumps over the lazy dog."] * 200
    encodings = tokenizer(texts, return_tensors="pt", padding=True, truncation=True, max_length=32)
    input_ids = encodings["input_ids"]

    for step in range(5):
        batch = input_ids[step*20:(step+1)*20].to(f"cuda:{local_rank}")
        outputs = model(batch, labels=batch)
        loss = outputs.loss
        loss.backward()
        optimizer.step()
        optimizer.zero_grad()
        if rank == 0:
            print(f"  Step {step+1}/5 loss={loss.item():.4f}")

    # Intentional stderr
    if rank == 0:
        print("FSDP training stderr test", file=sys.stderr, flush=True)

    # --- Save FSDP checkpoint ---
    if rank == 0:
        ckpt_dir = os.environ.get("RV_CHECKPOINT_DIR", "/tmp")
        os.makedirs(ckpt_dir, exist_ok=True)
        ckpt_path = os.path.join(ckpt_dir, "fsdp_checkpoint.pt")

        print(f"\n[Checkpoint]")
        print(f"  Saving to: {ckpt_path}")

    # FSDP state dict (full state on rank 0)
    from torch.distributed.fsdp import FullStateDictConfig, StateDictType
    full_cfg = FullStateDictConfig(offload_to_cpu=True, rank0_only=True)
    with FSDP.state_dict_type(model, StateDictType.FULL_STATE_DICT, full_cfg):
        state = model.state_dict()
        if rank == 0:
            ckpt_dir = os.environ.get("RV_CHECKPOINT_DIR", "/tmp")
            ckpt_path = os.path.join(ckpt_dir, "fsdp_checkpoint.pt")
            torch.save(state, ckpt_path)
            size_kb = os.path.getsize(ckpt_path) / 1024
            print(f"  Saved: {size_kb:.1f} KB")

    # --- Summary ---
    if rank == 0:
        print(f"\n[Result]")
        print(f"  FSDP training: PASSED")
        print(f"  HF model cache: {'PASSED' if hf_home else 'SKIPPED (no HF_HOME)'}")
        print(f"  Checkpoint save: PASSED")

    dist.destroy_process_group()

if __name__ == "__main__":
    main()
