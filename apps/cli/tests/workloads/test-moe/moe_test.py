import torch, os
from transformers import AutoModelForCausalLM, AutoTokenizer

model_name = "mistralai/Mixtral-8x7B-Instruct-v0.1"
# Mixtral is ~90GB in fp16, ~45GB in 4-bit
# Need at least 2x A100-80GB or 4x A6000

print(f"GPU count: {torch.cuda.device_count()}")
for i in range(torch.cuda.device_count()):
    print(f"  GPU {i}: {torch.cuda.get_device_name(i)}, VRAM: {torch.cuda.get_device_properties(i).total_memory/1e9:.0f}GB")

print(f"\nLoading {model_name} with device_map='auto'...")
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype=torch.float16,
    device_map="auto",  # Auto-shard across available GPUs
    low_cpu_mem_usage=True,
)

# Report device map
print("\nDevice map:")
for name, device in model.hf_device_map.items():
    print(f"  {name}: {device}")

# Memory usage
for i in range(torch.cuda.device_count()):
    alloc = torch.cuda.memory_allocated(i) / 1e9
    print(f"  GPU {i} allocated: {alloc:.1f} GB")

# Generate
prompt = "Explain the key insight behind Mixture of Experts models in 2 sentences:"
inputs = tokenizer(prompt, return_tensors="pt").to("cuda:0")
with torch.no_grad():
    output = model.generate(**inputs, max_new_tokens=128, temperature=0.7)
print(f"\nPrompt: {prompt}")
print(f"Output: {tokenizer.decode(output[0], skip_special_tokens=True)}")
