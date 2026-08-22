#!/usr/bin/env bash
# ==============================================================================
# yoof1337 — 1-Click Rented GPU Bootstrap Script for llama.cpp
#
# Tested on: Ubuntu 22.04 / 24.04 (RunPod, Vast.ai, Lambda, Tensordock)
# Usage:
#   bash scripts/setup-gpu.sh [MODEL_URL] [PORT] [CONTEXT_SIZE]
# ==============================================================================

set -euo pipefail

DEFAULT_MODEL_URL="https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct-GGUF/resolve/main/qwen2.5-coder-32b-instruct-q4_k_m.gguf"
MODEL_URL="${1:-$DEFAULT_MODEL_URL}"
PORT="${2:-8080}"
CONTEXT_SIZE="${3:-32768}"
MODEL_DIR="$HOME/models"
MODEL_FILE="$MODEL_DIR/$(basename "$MODEL_URL")"
LLAMA_DIR="$HOME/llama.cpp"

echo "========================================================"
echo "  🚀 yoof1337 GPU Bootstrap for llama.cpp Server"
echo "========================================================"

# 1. Check NVIDIA GPU
if command -v nvidia-smi &> /dev/null; then
    echo "✓ GPU Detected:"
    nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
else
    echo "⚠️  WARNING: nvidia-smi not found. Ensure NVIDIA drivers and CUDA are installed."
fi

# 2. Install Build Dependencies
echo ""
echo "📦 Installing system dependencies..."
sudo apt-get update -qq && sudo apt-get install -y -qq \
    build-essential \
    cmake \
    git \
    curl \
    wget \
    ccache \
    pkg-config \
    pciutils

# 3. Build llama.cpp with CUDA support
if [ ! -f "$LLAMA_DIR/build/bin/llama-server" ]; then
    echo ""
    echo "🔨 Cloning and compiling llama.cpp with CUDA..."
    if [ ! -d "$LLAMA_DIR" ]; then
        git clone https://github.com/ggerganov/llama.cpp.git "$LLAMA_DIR"
    fi
    cd "$LLAMA_DIR"
    cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
    cmake --build build --config Release -j "$(nproc)" --target llama-server
    echo "✓ llama-server compiled successfully."
else
    echo "✓ Existing llama-server found at $LLAMA_DIR/build/bin/llama-server"
fi

# 4. Download GGUF Model
mkdir -p "$MODEL_DIR"
if [ ! -f "$MODEL_FILE" ]; then
    echo ""
    echo "📥 Downloading model from: $MODEL_URL"
    echo "   Target: $MODEL_FILE"
    wget -c --show-progress -O "$MODEL_FILE" "$MODEL_URL"
    echo "✓ Model download complete."
else
    echo "✓ Model already exists at $MODEL_FILE"
fi

# 5. Generate Start Script
START_SCRIPT="$HOME/start-llama-server.sh"
cat <<EOF > "$START_SCRIPT"
#!/usr/bin/env bash
echo "Starting llama-server on port $PORT with context $CONTEXT_SIZE..."
exec "$LLAMA_DIR/build/bin/llama-server" \\
  -m "$MODEL_FILE" \\
  --host 0.0.0.0 \\
  --port $PORT \\
  -c $CONTEXT_SIZE \\
  -ngl 999 \\
  --jinja \\
  --metrics \\
  --cont-batching \\
  --parallel 2
EOF
chmod +x "$START_SCRIPT"

echo ""
echo "========================================================"
echo "  ✅ Setup Complete!"
echo "========================================================"
echo "To start the llama.cpp server manually, run:"
echo "   $START_SCRIPT"
echo ""
echo "To connect from your local PC using an SSH tunnel:"
echo "   ssh -L $PORT:localhost:$PORT root@<YOUR_GPU_IP>"
echo ""
echo "Then point yoof1337 to it in config.json:"
echo "   \"baseUrl\": \"http://localhost:$PORT/v1\""
echo "========================================================"
echo "Starting server in background now..."
nohup "$START_SCRIPT" > "$HOME/llama-server.log" 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID (Logs: $HOME/llama-server.log)"
echo "Waiting for server to initialize on port $PORT..."
sleep 5

if curl -s "http://localhost:$PORT/v1/models" > /dev/null; then
    echo "✓ Health Check PASSED: llama-server is online and responding at http://localhost:$PORT/v1"
else
    echo "ℹ️  Server is loading weights into VRAM. Check progress with: tail -f $HOME/llama-server.log"
fi
