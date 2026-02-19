import os, torch, torch.distributed as dist
from torch.distributed.fsdp import FullyShardedDataParallel as FSDP
from transformers import AutoModelForCausalLM, AutoTokenizer
from torch.utils.data import DataLoader

def main():
    dist.init_process_group("nccl")
    rank = dist.get_rank()
    local_rank = int(os.environ["LOCAL_RANK"])
    torch.cuda.set_device(local_rank)

    model_name = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
    if rank == 0:
        print(f"Loading {model_name} with FSDP...")

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(model_name, torch_dtype=torch.bfloat16)
    model = FSDP(model, device_id=local_rank)

    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-5)

    # Synthetic training data
    texts = ["The quick brown fox jumps over the lazy dog."] * 100
    encodings = tokenizer(texts, return_tensors="pt", padding=True, truncation=True, max_length=64)
    input_ids = encodings["input_ids"]

    for step in range(10):
        batch = input_ids[step*10:(step+1)*10].to(f"cuda:{local_rank}")
        outputs = model(batch, labels=batch)
        loss = outputs.loss
        loss.backward()
        optimizer.step()
        optimizer.zero_grad()
        if rank == 0 and step % 5 == 0:
            print(f"Step {step}/10 loss={loss.item():.4f}")

    # Save with FSDP
    if rank == 0:
        ckpt_dir = os.environ.get("RV_CHECKPOINT_DIR", "/tmp")
        print(f"FSDP training complete. Checkpoint dir: {ckpt_dir}")

    dist.destroy_process_group()

if __name__ == "__main__":
    main()
