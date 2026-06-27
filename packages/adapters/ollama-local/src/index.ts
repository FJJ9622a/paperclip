export const type = "ollama";
export const label = "Ollama (local)";
export const DEFAULT_OLLAMA_URL = "http://host.docker.internal:11434";
export const DEFAULT_OLLAMA_MODEL = "ornith:9b";
export const models: Array<{ id: string; label: string }> = [
  { id: "ornith:9b", label: "Ornith 1.0 9B (Agentic coding)" },
  { id: "hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q4_K_M", label: "Ornith 1.0 9B (full tag)" },
  { id: "glm-5.1:cloud", label: "GLM-5.1 744B (Cloud)" },
  { id: "glm4", label: "GLM-4 (Local)" },
  { id: "qwen3:8b", label: "Qwen 3 8B (Local)" },
  { id: "gemma4:e4b", label: "Gemma 4 E4B (Local)" },
  { id: "gemma4:e2b", label: "Gemma 4 E2B (Local)" },
];
export const agentConfigurationDoc = "# ollama adapter\nUse for open-source models via Ollama.\n- url: Ollama API URL (default: http://host.docker.internal:11434)\n- model: Model name (required). Recommended for agentic coding: ornith:9b\n- promptTemplate: Prompt template\n- timeoutSec: Timeout (default: 300)\n- systemPrompt: System prompt\n";