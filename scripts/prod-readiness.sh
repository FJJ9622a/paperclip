#!/bin/bash
# Paperclip production readiness gate — exit 0 = ready
set -euo pipefail
FAIL=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; FAIL=1; }

echo "=== PAPERCLIP PRODUCTION READINESS ==="

# 1 Health local + public
if curl -fsS http://127.0.0.1:3100/api/health | grep -q '"status":"ok"'; then
  pass health_local
else
  fail health_local
fi
if curl -fsS https://paper.mpi-edx.com/api/health | grep -q '"status":"ok"'; then
  pass health_public
else
  fail health_public
fi

# 2 Container up
if docker ps --format '{{.Names}}' | grep -q '^docker-server-1$'; then
  pass container_running
else
  fail container_running
fi

# 3 Grok CLI subscription (no API key)
HOST_GROK=$(grok models 2>&1 | head -3)
if echo "$HOST_GROK" | grep -q 'grok.com'; then
  pass grok_host_subscription
else
  fail grok_host_subscription
fi
if echo "$HOST_GROK" | grep -q 'XAI_API_KEY'; then
  fail grok_host_no_api_key
else
  pass grok_host_no_api_key
fi
CTR_GROK=$(docker exec -u node docker-server-1 grok models 2>&1 | head -3)
if echo "$CTR_GROK" | grep -q 'grok.com'; then
  pass grok_container_subscription
else
  fail grok_container_subscription
fi
KEYLEN=$(docker exec docker-server-1 sh -c 'echo ${#XAI_API_KEY}')
if [ "$KEYLEN" = "0" ]; then
  pass no_xai_env
else
  fail no_xai_env
fi

# 4 Ollama
if curl -fsS http://127.0.0.1:11434/api/tags 2>/dev/null | grep -q 'ornith:9b' \
  || ollama list 2>/dev/null | grep -q 'ornith:9b'; then
  pass ollama_ornith
else
  fail ollama_ornith
fi

# 5 Runtime patches
for d in adapter-grok adapter-ollama startup-patch.sh patch-adapters.py; do
  if [ -e "$HOME/paperclip/data/docker-paperclip/$d" ]; then
    pass "patch_$d"
  else
    fail "patch_$d"
  fi
done

# 6 Agents in DB
GROK_AGENTS=$(docker exec -i docker-db-1 psql -U paperclip -d paperclip -tAc \
  "SELECT count(*) FROM agents WHERE adapter_type='grok_local' AND adapter_config->>'authMode'='cli'")
OLLAMA_AGENTS=$(docker exec -i docker-db-1 psql -U paperclip -d paperclip -tAc \
  "SELECT count(*) FROM agents WHERE adapter_type='ollama'")
if [ "${GROK_AGENTS:-0}" -ge 1 ]; then pass grok_agents_db; else fail grok_agents_db; fi
if [ "${OLLAMA_AGENTS:-0}" -ge 1 ]; then pass ollama_agents_db; else fail ollama_agents_db; fi

# 7 Adapter testEnvironment
docker exec -u node docker-server-1 node --import /app/server/node_modules/tsx/dist/loader.mjs -e "
import { testEnvironment as gt } from '/paperclip/adapter-grok/src/server/test.ts';
import { testEnvironment as ot } from '/paperclip/adapter-ollama/src/server/test.ts';
const g = await gt({ authMode: 'cli', command: 'grok' });
const o = await ot({ config: { url: 'http://host.docker.internal:11434', model: 'ornith:9b' } });
if (!g.ok) process.exit(2);
if (o.status !== 'pass') process.exit(3);
console.log('ADAPTER_TESTS_OK');
" && pass adapter_test_env || fail adapter_test_env

# 8 Grok auth ownership
OWNER=$(stat -c '%U' /home/ubuntu/.grok/auth.json 2>/dev/null || echo missing)
if [ "$OWNER" = ubuntu ]; then pass grok_auth_owner; else fail grok_auth_owner; fi

# 9 Cron guard
if crontab -l 2>/dev/null | grep -q '.grok'; then pass grok_cron; else fail grok_cron; fi

# 10 Git clean on server
if [ -z "$(cd ~/paperclip && git status --porcelain)" ]; then
  pass git_clean
else
  fail git_clean
fi

echo "=== RESULT: $([ $FAIL -eq 0 ] && echo PRODUCTION_READY || echo NOT_READY) ==="
exit $FAIL