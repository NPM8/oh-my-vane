Vane + Bonsai: optional local inference kit
==========================================

This directory packages the working gateway bridge and a portable launcher;
it is not an installer. No models, binaries, credentials, user configuration,
or captured API responses are bundled. Existing providers and embeddings
must be retained. No application source changes are required.
The base docker-compose.yaml does not enable Bonsai. Its provider environment
settings are opt-in through the explicit Compose overlay below.

Dependencies and tested profile
-------------------------------
Use the official https://github.com/PrismML-Eng/Bonsai-demo repository.
Reference checkout: d5ea901004ae983f5bea86dd2e3f5fa1fe915e2c.
Follow that project's setup documentation separately, reviewing downloads and
licenses. This kit never downloads models or installs a driver.

  Runtime fork: https://github.com/PrismML-Eng/llama.cpp
  Pinned release: prism-b10772-e8fd209, Linux CUDA 13.3
  Model: https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf
  Pinned revision: b072e1d3b35a0a630cece372c2127528e0994386
  Weights: PQ2_0; vision projector: Q8_0

Do not substitute stock llama.cpp or Ollama for this fork: Bonsai 2 needs
PrismML's transforms and kernels. Provision weights and the CUDA binary in
the official checkout using its instructions before launching this kit.

The tested hardware is an NVIDIA RTX 3090 with 24 GB VRAM, a CUDA-13.3-compatible
NVIDIA driver, Linux, Python 3.11 in the Bonsai .venv, Docker Compose, and systemd
user services (optional). Reserve system RAM for the CPU vision projector and
unload competing GPU models. This profile is not a guarantee for every workload
or smaller GPU. The stdlib bridge itself needs only /usr/bin/python3, no venv.

Launcher profile: Bonsai 2 27B, all CUDA layers, 262144-token context, one slot,
FP16 K / Q8_0 V cache, BONSAI_KV4=0, CPU projector, reasoning effort medium,
reasoning budget 8192, maximum generated tokens 32768, alias bonsai-2-27b,
and loopback 127.0.0.1:8080. Both-Q8 cache caused repetition during prior tests;
do not silently replace the mixed cache profile with both-Q8.

Setup and manual use (templates; review before running)
------------------------------------------------------
Run from the Vane repository root after provisioning Bonsai independently:

  export BONSAI_DIR="$HOME/projects/Bonsai-demo"
  uv pip install --python "$BONSAI_DIR/.venv/bin/python" -r local/bonsai/requirements-runtime.txt
  sh local/bonsai/start-bonsai.sh

requirements-runtime.txt pins the two additional CUDA runtime libraries. It is
not a replacement for the upstream project's dependencies. The launcher uses
.venv/lib/python3.11/site-packages/nvidia/cu13/lib and bin/cuda within BONSAI_DIR;
if using another Python layout, adjust that library path deliberately. Upstream
venv resyncs may remove these extra libraries; reinstall the pinned requirements
if needed. No system CUDA installation or user-wide configuration is changed.
BONSAI_DIR defaults to $HOME/projects/Bonsai-demo and supports spaces.
Extra arguments are forwarded to the official launcher; do not pass host flags
that expose the server to a LAN or the Internet.

Docker route and restricted bridge
----------------------------------
The default path is:
  Vane -> http://172.22.0.1:8084/v1 -> http://127.0.0.1:8080/v1

Inspect your actual project network, rather than assuming these addresses:

  docker compose ps
  docker inspect <vane-container> --format '{{json .NetworkSettings.Networks}}'
  docker network inspect <project-network> --format '{{json .IPAM.Config}}'

vane_bridge_proxy.py binds only to BIND_HOST=172.22.0.1, BIND_PORT=8084,
allows peers only from NETWORK=172.22.0.0/16, and forwards to loopback port 8080.
If your gateway/subnet differs, edit those constants to match the inspected
project network. Keep the bind address on that Docker gateway and the peer
allowlist limited to that project subnet; do not use 0.0.0.0, ::, 0.0.0.0/0,
a public interface, or arbitrary peer networks. If changing a port, update
BIND_PORT and BONSAI_OPENAI_BASE_URL together (and UPSTREAM_PORT if the server changes).
Recheck these values after Docker networks are recreated. Docker must have
created the gateway before the bridge can bind. The bridge is plain TCP with
no authentication/TLS: every allowed container can use the model. Do not
publish this port, and do not treat this as an Internet-facing API gateway.

  /usr/bin/python3 local/bonsai/vane_bridge_proxy.py

The optional local/bonsai/docker-compose.bonsai.yaml overlay supplies Vane's
supported startup settings:
  OPENAI_BASE_URL=http://172.22.0.1:8084/v1
  OPENAI_API_KEY=local-bonsai-placeholder

The key is a non-secret local placeholder required by the OpenAI client; it
does not secure the bridge. BONSAI_OPENAI_BASE_URL defaults to the tested Docker
gateway endpoint http://172.22.0.1:8084/v1. If your inspected gateway or bridge
port differs, export BONSAI_OPENAI_BASE_URL with the matching URL before running
Compose; this changes the provider endpoint, not the bridge bind/peer settings.

From the repository root, explicitly select both files to validate and run:

  docker compose -f docker-compose.yaml -f local/bonsai/docker-compose.bonsai.yaml config --quiet
  docker compose -f docker-compose.yaml -f local/bonsai/docker-compose.bonsai.yaml up -d --no-deps vane

Use the same two -f arguments for subsequent Bonsai Compose operations. Running
only the base Compose file does not inject these Bonsai environment settings.
The overlay changes only vane's provider environment: existing ports, networks,
security settings and the vane-data volume remain unchanged. Startup settings
add a local OpenAI provider without replacing existing persisted providers or
embedding configuration. In Vane choose the OpenAI provider
with this endpoint and chat model bonsai-2-27b. Retain existing Transformers,
Ollama, official OpenAI, and embedding provider configuration. Bonsai here is
chat-only, not an embedding service. Do not change account preferences blindly.

Optional systemd user service examples
--------------------------------------
The units assume this repository is $HOME/projects/oh-my-vane. Adjust ExecStart
paths if it is elsewhere. bonsai.service sets BONSAI_DIR=%h/projects/Bonsai-demo;
change that Environment entry (or a unit drop-in) for another checkout. systemd
unit Environment values do not expand shell $HOME; use %h or an explicit path.
The bridge executes repository-local Python with /usr/bin/python3, not a Bonsai
venv. After reviewing prerequisites and avoiding duplicate running servers:

  mkdir -p "$HOME/.config/systemd/user"
  cp local/bonsai/bonsai.service local/bonsai/bonsai-vane-bridge.service "$HOME/.config/systemd/user/"
  systemctl --user daemon-reload
  systemctl --user enable --now bonsai.service bonsai-vane-bridge.service
  systemctl --user status bonsai.service bonsai-vane-bridge.service
  journalctl --user -u bonsai.service -u bonsai-vane-bridge.service -n 100

These are examples, not actions performed by packaging. The units retry on
failure; After= orders units but does not mean model readiness. The bridge may
start before inference is ready. Boot-without-login depends on your existing
user-manager/lingering policy; this kit does not change it.

Tests and limits of verification
---------------------------------
Offline checks from the Vane repository root (no model or Docker required):

  python3 -m unittest discover -s local/bonsai -p 'test_*.py' -v
  sh -n local/bonsai/start-bonsai.sh
  node --check local/bonsai/smoke-test.cjs
  systemd-analyze --user verify local/bonsai/bonsai.service local/bonsai/bonsai-vane-bridge.service

Tests use a temporary launcher capture script to verify both default/custom
checkout paths, the exported profile and forwarded arguments. Bridge tests
check peer restrictions and real loopback TCP transport/half-close, not fake
OpenAI responses. They do not start or modify production services.

Live checks, once the server, bridge and Vane are ready:

  curl --fail http://127.0.0.1:8080/v1/models
  docker exec -i <vane-container> node < local/bonsai/smoke-test.cjs

The smoke script uses Vane's installed OpenAI/Zod SDKs and container environment.
It asserts discovery, real chat, streaming, structured JSON, native tool calls,
and nonempty results from the existing http://searxng-core:8091 search service.
That SearXNG URL is deployment-specific; adjust it if your service differs.
It prints actual results, fails on errors, and may fail on reasoning-budget or
network limits. The SearXNG fetch has a 30-second timeout to bound network waiting.
Do not replace failed responses with canned data. Operational verification.json
and docker-compose.before.yaml are local ignored artifacts,
not public test fixtures; do not commit them or user config/backups.

Prior integration checks passed these backend paths and retained prior
providers; this packaging alone does not revalidate the running deployment.
The signed-in UI and complete authenticated search/retrieval flow remain
untested. Use an authorized login to verify those; do not bypass authentication.

Rollback: disable/stop only these optional units if you installed them, then
run docker compose -f docker-compose.yaml up -d --no-deps vane without the
overlay to remove its startup environment settings. This does not delete the
persisted local provider; remove only that provider through authorized Vane
configuration if desired, or restore your own private provider backup.
Never remove the Vane data volume or unrelated providers to undo this route.
