import os, time, signal, sys

total_elapsed = int(os.environ.get("RV_TOTAL_ELAPSED", "0"))
total_requested = int(os.environ.get("RV_TOTAL_REQUESTED", "600"))
segment_start = time.time()

def handle_signal(signum, frame):
    elapsed = time.time() - segment_start
    print(f"Received signal {signum} after {elapsed:.0f}s in this segment")
    print(f"Total elapsed: {total_elapsed + elapsed:.0f}s / {total_requested}s")
    sys.exit(1)  # Non-zero exit triggers resubmission

signal.signal(signal.SIGUSR1, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)

print(f"Starting segment. Prior elapsed: {total_elapsed}s, requested: {total_requested}s")
print(f"Checkpoint dir: {os.environ.get('RV_CHECKPOINT_DIR', 'not set')}")
print(f"Job end time: {os.environ.get('SLURM_JOB_END_TIME', 'not set')}")

# Simulate work
for i in range(3600):
    time.sleep(1)
    if i % 60 == 0:
        print(f"Working... {i}s elapsed in this segment, {total_elapsed + i}s total")
