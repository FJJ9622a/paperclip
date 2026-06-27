import { DEFAULT_GROK_MODEL } from "../index.js";

const XAI_API_BASE = "https://api.x.ai/v1";

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function mapModelForApi(model: string): string {
  if (model === "grok-build" || model === "grok-composer-2.5-fast") return "grok-3-fast";
  return model;
}

export async function executeViaApi(ctx: {
  config: Record<string, unknown>;
  prompt: string;
  apiKey: string;
  onLog: (stream: "stdout" | "stderr", chunk: string) => void | Promise<void>;
}): Promise<{
  summary: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const model = mapModelForApi(asString(ctx.config.model, DEFAULT_GROK_MODEL));
  const body = {
    model,
    messages: [{ role: "user", content: ctx.prompt }],
    stream: false,
  };

  await ctx.onLog("stdout", `[grok] API ${XAI_API_BASE}/chat/completions model=${model}\n`);

  const response = await fetch(`${XAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`xAI API ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const summary = data.choices?.[0]?.message?.content?.trim() || "";
  if (!summary) throw new Error("xAI API returned empty response");

  return {
    summary,
    model: data.model || model,
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}
