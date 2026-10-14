#!/bin/sh
# Tested RTX 3090 profile; depends on an already provisioned official checkout.
set -eu
BONSAI_DIR="${BONSAI_DIR:-$HOME/projects/Bonsai-demo}"
export BONSAI_FAMILY=bonsai2
export BONSAI_MODEL=27B
export BONSAI_HOST=127.0.0.1
export PORT=8080
export BONSAI_NGL=999
export BONSAI_CTX=262144
export BONSAI_KV4=0
export BONSAI_MMPROJ_CPU=1
export BONSAI_LLAMA_BIN="$BONSAI_DIR/bin/cuda"
export LD_LIBRARY_PATH="$BONSAI_DIR/.venv/lib/python3.11/site-packages/nvidia/cu13/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$BONSAI_DIR/scripts/start_llama_server.sh" \
  --alias bonsai-2-27b \
  --parallel 1 \
  --cache-type-k f16 \
  --cache-type-v q8_0 \
  --n-predict 32768 \
  --reasoning-budget 8192 \
  --chat-template-kwargs '{"reasoning_effort":"medium"}' \
  "$@"
