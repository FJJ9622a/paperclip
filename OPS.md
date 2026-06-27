# Paperclip operations quick reference

Live host: `ubuntu@100.26.101.226` | URL: https://paper.mpi-edx.com | Container: `docker-server-1` (port 3100)

## Adapters

| Adapter ID | Label | Default model | Auth / URL |
| --- | --- | --- | --- |
| `grok_local` | xAI Grok | `grok-build` | **`cli` only** — grok.com subscription (`grok login`). No API keys. |
| `ollama` | Ollama | `ornith:9b` | `http://host.docker.internal:11434` |

### Agent setup recommendations

- **All Grok work:** `grok_local` + `grok-build` + `authMode: cli` (subscription session)
- **Private local coding:** `ollama` + `ornith:9b` (slow on CPU, no GPU)
- **Do not use** `authMode: api_key` or `XAI_API_KEY` — MPI policy is CLI subscription only

## Health and smoke

```bash
curl -fsS http://127.0.0.1:3100/api/health
grok models | head -5
docker exec -u node docker-server-1 grok models | head -5
ollama list | head -8
```

**Pass:** health `status: ok`; host and container grok both logged in.

## Restart

```bash
cd ~/paperclip/docker && docker compose restart server
```

After restart, re-run smoke gates above. Grok `auth.json` must stay owned by `ubuntu:ubuntu`.

## Grok auth recovery

```bash
sudo chown -R ubuntu:ubuntu ~/.grok
ls -la ~/.grok/auth.json   # expect ubuntu:ubuntu
crontab -l | grep grok     # 10-min chown guard
```

## Adapter patches

Patches live on host: `~/paperclip/data/docker-paperclip/`

**Important:** `adapter-grok` must stay the **MPI custom build** (from commit `d60aa93d`), not a straight copy of upstream `packages/adapters/grok-local`. Upstream grok-local requires `@paperclipai/adapter-utils` in the runtime symlink path and will crash the server if copied blindly to `data/docker-paperclip/adapter-grok`. Safe to sync `adapter-ollama` from `packages/adapters/ollama-local`.

| Path | Role |
| --- | --- |
| `adapter-grok/` | `grok_local` adapter source |
| `adapter-ollama/` | `ollama` adapter source |
| `startup-patch.sh` | Entrypoint: symlinks, chown, registry |
| `patch-adapters.py` | Registers adapters in server registry |
| `patch-ui-bundle.py` | UI adapter picker injection |

Edit patches on host → restart container → smoke.

## Ollama

```bash
ollama list
ollama pull hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q4_K_M
ollama cp hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q4_K_M ornith:9b
```

Hardware: 30 GB RAM, 4 vCPU, no GPU — do not deploy Ornith 397B.

## Grok CLI

- Config: `~/.grok/config.toml` (`auto_update = true`)
- Mount: `/home/ubuntu/.grok` → `/paperclip/.grok` in container

## Grok auth policy

MPI uses **Grok CLI subscription only** (`grok login` → `~/.grok/auth.json`). Do not configure `XAI_API_KEY` in `.env` or compose. In Paperclip, set every Grok agent to `authMode: cli`.

## Local agent docs (Windows workspace)

`C:\Users\franc\Nextcloud2\AI\paperclip\docs\agent\memory.md`