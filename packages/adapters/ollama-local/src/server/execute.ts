// Self-contained execute - no external adapter-utils imports needed

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}
function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function parseObject(v: unknown): Record<string, unknown> {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}
function renderTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const parts = key.trim().split(".");
    let val: any = data;
    for (const p of parts) { val = val?.[p]; }
    return val != null ? String(val) : "";
  });
}

import { DEFAULT_OLLAMA_URL, DEFAULT_OLLAMA_MODEL } from "../index.js";

export async function execute(ctx: any): Promise<any> {
  const { runId, agent, config, context, onLog, onMeta } = ctx;
  const url = asString(config.url, DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  const model = asString(config.model, DEFAULT_OLLAMA_MODEL);
  const timeoutSec = asNumber(config.timeoutSec, 300);
  const systemPrompt = asString(config.systemPrompt, "");
  const promptTemplate = asString(config.promptTemplate, "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.");

  const templateData = { agentId: agent.id, companyId: agent.companyId, runId, agent, context };
  const renderedPrompt = renderTemplate(promptTemplate, templateData);
  const handoff = asString(context.paperclipSessionHandoffMarkdown, "");
  const prompt = [handoff, renderedPrompt].filter(Boolean).join("\n\n");

  if (onMeta) {
    await onMeta({ adapterType: "ollama", command: "ollama:" + model, cwd: process.cwd(), commandArgs: [], commandNotes: ["Ollama API: " + url, "Model: " + model], env: {}, prompt, promptMetrics: { promptChars: prompt.length }, context });
  }
  await onLog("stdout", "[ollama] Calling " + url + "/api/chat model=" + model + "\n");

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const controller = new AbortController();
  const timer = timeoutSec > 0 ? setTimeout(() => controller.abort(), timeoutSec * 1000) : null;

  try {
    const response = await fetch(url + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: controller.signal,
    });
    if (timer) clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      await onLog("stderr", "[ollama] Error " + response.status + ": " + errorText + "\n");
      return { exitCode: 1, signal: null, timedOut: false, errorMessage: "Ollama " + response.status + ": " + errorText.slice(0, 200), errorCode: "adapter_failed", provider: "ollama", model, billingType: "api", costUsd: 0 };
    }

    const data = await response.json();
    const summary = data.message?.content || data.message?.reasoning || "";
    const inputTokens = data.prompt_eval_count || 0;
    const outputTokens = data.eval_count || 0;
    await onLog("stdout", "[ollama] " + inputTokens + " in / " + outputTokens + " out tokens\n");
    await onLog("stdout", "[ollama] Response: " + summary.slice(0, 300) + "\n");

    const sessionId = "ollama-" + runId.slice(0, 8);
    return {
      exitCode: 0, signal: null, timedOut: false, errorMessage: null,
      usage: { inputTokens, outputTokens, cachedInputTokens: 0 },
      sessionId, sessionParams: { sessionId }, sessionDisplayId: sessionId,
      provider: "ollama", biller: "ollama", model: data.model || model,
      billingType: "api", costUsd: 0,
      resultJson: { result: summary, model: data.model || model, usage: { input_tokens: inputTokens, output_tokens: outputTokens } },
      summary,
    };
  } catch (err: any) {
    if (timer) clearTimeout(timer);
    if (err.name === "AbortError") {
      return { exitCode: null, signal: null, timedOut: true, errorMessage: "Timeout after " + timeoutSec + "s", errorCode: "timeout", provider: "ollama", model, billingType: "api", costUsd: 0 };
    }
    const isConn = /ECONNREFUSED|ENOTFOUND|fetch failed/i.test(err.message || "");
    return { exitCode: 1, signal: null, timedOut: false, errorMessage: isConn ? "Cannot connect to Ollama at " + url : "Error: " + (err.message || err).toString().slice(0, 200), errorCode: isConn ? "connection_failed" : "adapter_failed", provider: "ollama", model, billingType: "api", costUsd: 0 };
  }
}
