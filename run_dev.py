#!/usr/bin/env python3
import subprocess, signal, sys, os, time, threading

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
flask_proc = None
vite_proc = None

FLASK_PORT = os.environ.get('FLASK_PORT', os.environ.get('PORT', '5199'))
VITE_PORT = os.environ.get('VITE_PORT', '5198')
FLASK_TAG = "\033[96m[flask]\033[0m"
VITE_TAG  = "\033[93m[vite]\033[0m"


def cleanup(sig=None, frame=None):
    for p in (flask_proc, vite_proc):
        if p and p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
    sys.exit(0)


def stream_output(proc, tag):
    """Read proc stdout line-by-line and print with a colored tag."""
    for raw in iter(proc.stdout.readline, b""):
        line = raw.decode("utf-8", errors="replace").rstrip()
        if line:
            print(f"{tag} {line}")
    proc.stdout.close()


signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

# ── Flask ───────────────────────────────────────────
print(f"Starting Flask backend on :{FLASK_PORT}...")
flask_env = dict(os.environ, FLASK_PORT=FLASK_PORT)
flask_proc = subprocess.Popen(
    [sys.executable, "-u", "run.py"],
    cwd=BASE_DIR,
    env=flask_env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    bufsize=1,
)

# ── Vite ────────────────────────────────────────────
print(f"Starting Vite dev server on :{VITE_PORT}...")
vite_proc = subprocess.Popen(
    ["npx", "vite", "--port", VITE_PORT],
    cwd=os.path.join(BASE_DIR, "digital-edu-web"),
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    bufsize=1,
)

# ── Stream both in background threads ───────────────
t1 = threading.Thread(target=stream_output, args=(flask_proc, FLASK_TAG), daemon=True)
t2 = threading.Thread(target=stream_output, args=(vite_proc, VITE_TAG), daemon=True)
t1.start()
t2.start()

time.sleep(2)
print()
print(f"  {FLASK_TAG} http://localhost:{FLASK_PORT}")
print(f"  {VITE_TAG}  http://localhost:{VITE_PORT}")
print()
print("  Press Ctrl+C to stop both")
print()

try:
    while True:
        if flask_proc.poll() is not None:
            print(f"\n{FLASK_TAG} Exited with code {flask_proc.returncode}")
            break
        if vite_proc.poll() is not None:
            print(f"\n{VITE_TAG} Exited with code {vite_proc.returncode}")
            break
        time.sleep(1)
except KeyboardInterrupt:
    pass
finally:
    cleanup()
