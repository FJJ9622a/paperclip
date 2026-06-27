-- MPI Paperclip production agents (CLI-only Grok + Ollama)
-- Company: MPI Holdings

INSERT INTO agents (
  id, company_id, name, role, title, status,
  adapter_type, adapter_config, default_environment_id
)
SELECT
  'a1111111-1111-4111-8111-111111111101',
  '1538ae5a-c903-4b76-9749-0bedee1d1c2e',
  'Grok Build',
  'general',
  'Primary agent (Grok CLI)',
  'idle',
  'grok_local',
  '{"authMode":"cli","model":"grok-build","command":"grok"}'::jsonb,
  '7d4c67d5-d13a-49d7-a842-a3f0992e6dc1'
WHERE NOT EXISTS (
  SELECT 1 FROM agents WHERE company_id = '1538ae5a-c903-4b76-9749-0bedee1d1c2e'
    AND adapter_type = 'grok_local' AND name = 'Grok Build'
);

INSERT INTO agents (
  id, company_id, name, role, title, status,
  adapter_type, adapter_config, default_environment_id
)
SELECT
  'a1111111-1111-4111-8111-111111111102',
  '1538ae5a-c903-4b76-9749-0bedee1d1c2e',
  'Ornith Local',
  'general',
  'Private coding (Ollama)',
  'idle',
  'ollama',
  '{"url":"http://host.docker.internal:11434","model":"ornith:9b"}'::jsonb,
  '7d4c67d5-d13a-49d7-a842-a3f0992e6dc1'
WHERE NOT EXISTS (
  SELECT 1 FROM agents WHERE company_id = '1538ae5a-c903-4b76-9749-0bedee1d1c2e'
    AND adapter_type = 'ollama' AND name = 'Ornith Local'
);

SELECT id, name, adapter_type, adapter_config->>'authMode' AS auth_mode,
       adapter_config->>'model' AS model
FROM agents
WHERE company_id = '1538ae5a-c903-4b76-9749-0bedee1d1c2e'
ORDER BY name;