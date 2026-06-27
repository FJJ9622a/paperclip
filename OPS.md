# Paperclip operations quick reference

Live host: `ubuntu@100.26.101.226` | URL: https://paper.mpi-edx.com | Container: `docker-server-1` (port 3100)

## Adapters

| Adapter ID | Label | Default model | Auth / URL |
| --- | --- | --- | --- |
| `grok_local` | xAI Grok | `grok-build` | `cli` (grok login) or `api_key` (`XAI_API_KEY`) |
| `ollama` | Ollama | `ornith:9b` | `http://host.docker.internal:11434` |

### Agent setup recommendations

- **Primary agentic work:** `grok_local` + `grok-build` + `authMode: cli`
- **Headless / automation:** `grok_local` + `authMode: api_key` + env `XAI_API_KEY`
- **Private local coding:** `ollama` + `ornith:9b` (slow on CPU, no GPU)

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

## API key mode (`authMode: api_key`)

1. Add `XAI_API_KEY=xai-...` to `~/paperclip/docker/.env` (never commit).
2. Ensure `docker-compose.yml` maps `XAI_API_KEY: "${XAI_API_KEY:-}"`.
3. Restart: `cd ~/paperclip/docker && docker compose up -d server`
4. Verify: `docker exec docker-server-1 sh -c 'test -n \"$XAI_API_KEY\" && curl -fsS -H \"Authorization: Bearer $XAI_API_KEY\" https://api.x.ai/v1/models | head -c 100'`

## Local agent docs (Windows workspace)

`C:\Users\franc\Nextcloud2\AI\paperclip\docs\agent\memory.md`