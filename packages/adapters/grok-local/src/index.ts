export const type = "grok_local";
export const label = "xAI Grok (local)";
export const DEFAULT_GROK_COMMAND = "grok";
export const DEFAULT_GROK_MODEL = "grok-build";
export const DEFAULT_GROK_AUTH_MODE = "cli";

export const models: Array<{ id: string; label: string }> = [
  { id: "grok-build", label: "Grok Build" },
  { id: "grok-composer-2.5-fast", label: "Composer 2.5 Fast" },
  { id: "grok-4", label: "Grok 4 (API)" },
  { id: "grok-3", label: "Grok 3 (API)" },
];

export const agentConfigurationDoc = `# grok_local agent configuration

Adapter: grok_local

Use when:
- You want Paperclip to run xAI Grok locally via the Grok CLI
- You want either session-based CLI auth or API key auth

## Auth modes

| authMode | Description |
|----------|-------------|
| cli | Direct CLI connection using grok login session (~/.grok). No API key required. |
| api_key | Authenticate with an xAI API key (config.apiKey or env.XAI_API_KEY). Uses Grok CLI when available, otherwise direct xAI REST API. |

## Core fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| authMode | string | cli | cli or api_key |
| apiKey | string | | xAI API key (api_key mode). Prefer storing via env.XAI_API_KEY secret binding. |
| model | string | grok-build | Model id (required) |
| command | string | grok | Path to grok CLI binary |
| cwd | string | | Working directory |
| promptTemplate | string | | Run prompt template |
| timeoutSec | number | 600 | Timeout in seconds |
| env | object | | Extra environment variables |
`;