import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_GROK_AUTH_MODE, DEFAULT_GROK_COMMAND, DEFAULT_GROK_MODEL } from "../index.js";
import { executeViaApi } from "./execute-api.js";

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
function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const parts = String(key).trim().split(".");
    let val: unknown = data;
    for (const p of parts) val = (val as Record<string, unknown> | undefined)?.[p];
    return val != null ? String(val) : "";
  });
}
function extractStreamDelta(obj: Record<string, unknown>): string {
  if (!obj || typeof obj !== "object") return "";
  if (obj.type === "thought" || obj.type === "end" || obj.type === "tool_call") return "";
  if (obj.type === "text" && typeof obj.data === "string") return obj.data;
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.content === "string") return obj.content;
  const delta = obj.delta as Record<string, unknown> | undefined;
  if (typeof delta?.text === "string") return delta.text;
  if (typeof delta?.content === "string") return delta.content;
  const content = obj.content as Record<string, unknown> | undefined;
  if (typeof content?.text === "string") return content.text;
  const message = obj.message as Record<string, unknown> | undefined;
  if (message?.content) {
    const mc = message.content;
    return typeof mc === "string" ? mc : String((mc as Record<string, unknown>)?.text || "");
  }
  return "";
}

function stripAnsi(text: string): string {
  return text.replace(/\[[0-9;]*m/g, "");
}
function isGrokNoiseLine(line: string): boolean {
  const t = stripAnsi(line).trim();
  return !t || /^\d{4}-\d{2}-\d{2}T.*ERROR/.test(t) || /tool_error:|tool_output_error/.test(t);
}

function isAuthError(text: string): boolean {
  return /sign in|oauth2\/device|not authenticated|run `grok login`/i.test(text || "");
}

function resolveAuthMode(config: Record<string, unknown>): "cli" | "api_key" {
  const mode = asString(config.authMode, DEFAULT_GROK_AUTH_MODE).toLowerCase();
  return mode === "api_key" ? "api_key" : "cli";
}

function resolveApiKey(config: Record<string, unknown>): string {
  const direct = asString(config.apiKey, "");
  if (direct) return direct;
  const env = parseObject(config.env);
  const fromEnv = asString(env.XAI_API_KEY, "") || asString(env.GROK_API_KEY, "");
  if (fromEnv) return fromEnv;
  return asString(process.env.XAI_API_KEY, "") || asString(process.env.GROK_API_KEY, "");
}

function buildRuntimeEnv(config: Record<string, unknown>, authMode: "cli" | "api_key"): Record<string, string> {
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries({ ...process.env, ...parseObject(config.env) }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    HOME: process.env.HOME || "/paperclip",
  };
  if (authMode === "api_key") {
    const apiKey = resolveApiKey(config);
    if (apiKey) {
      env.XAI_API_KEY = apiKey;
      env.GROK_API_KEY = apiKey;
    }
  } else {
    delete env.XAI_API_KEY;
    delete env.GROK_API_KEY;
  }
  return env;
}

function redactEnvForLogs(env: Record<string, string>): Record<string, string> {
  const logged: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    logged[key] = /api_key|token|secret/i.test(key) ? "***" : value;
  }
  return logged;
}

async function executeViaCli(ctx: {
  runId: string;
  command: string;
  model: string;
  cwd: string;
  prompt: string;
  timeoutSec: number;
  runtimeEnv: Record<string, string>;
  onLog: (stream: "stdout" | "stderr", chunk: string) => void | Promise<void>;
}): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  summary: string;
  stderr: string;
  authFailed: boolean;
}> {
  const promptFile = path.join(os.tmpdir(), `paperclip-grok-${ctx.runId}.txt`);
  await fs.writeFile(promptFile, ctx.prompt, "utf8");
  const args = [
    "--prompt-file", promptFile,
    "-m", ctx.model,
    "--output-format", "streaming-json",
    "--no-alt-screen",
    "--permission-mode", "dontAsk",
    "--disable-web-search",
  ];

  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const proc = spawn(ctx.command, args, {
      cwd: ctx.cwd,
      env: ctx.runtimeEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = ctx.timeoutSec > 0 ? setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5000);
    }, ctx.timeoutSec * 1000) : null;

    const consumeLine = (line: string, stream: "stdout" | "stderr") => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (isAuthError(trimmed)) {
        stderr += `${trimmed}\n`;
        return;
      }
      if (trimmed.startsWith("{")) {
        try {
          const delta = extractStreamDelta(JSON.parse(trimmed));
          if (delta) {
            stdout += delta;
            void ctx.onLog("stdout", delta);
          }
        } catch {
          stdout += `${trimmed}\n`;
          void ctx.onLog(stream, `${trimmed}\n`);
        }
        return;
      }
      stdout += `${trimmed}\n`;
      void ctx.onLog(stream, `${trimmed}\n`);
    };

    let outBuf = "";
    let errBuf = "";
    proc.stdout?.on("data", (chunk) => {
      outBuf += chunk.toString();
      const lines = outBuf.split(/\r?\n/);
      outBuf = lines.pop() || "";
      for (const line of lines) consumeLine(line, "stdout");
    });
    proc.stderr?.on("data", (chunk) => {
      errBuf += chunk.toString();
      const lines = errBuf.split(/\r?\n/);
      errBuf = lines.pop() || "";
      for (const line of lines) consumeLine(line, "stderr");
    });

    proc.on("close", async (code, signal) => {
      if (timer) clearTimeout(timer);
      if (outBuf) consumeLine(outBuf, "stdout");
      if (errBuf) consumeLine(errBuf, "stderr");
      try { await fs.unlink(promptFile); } catch {}
      resolve({
        exitCode: code,
        signal,
        timedOut,
        summary: stdout.trim(),
        stderr,
        authFailed: isAuthError(stderr) || isAuthError(stdout),
      });
    });
  });
}

export async function execute(ctx: any): Promise<any> {
  const { runId, agent, config, context, onLog, onMeta } = ctx;
  const command = asString(config.command, DEFAULT_GROK_COMMAND);
  const model = asString(config.model, DEFAULT_GROK_MODEL);
  const timeoutSec = asNumber(config.timeoutSec, 600);
  const cwd = asString(config.cwd, process.cwd());
  const authMode = resolveAuthMode(config);
  const apiKey = resolveApiKey(config);
  const promptTemplate = asString(config.promptTemplate, "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.");
  const templateData = { agentId: agent.id, companyId: agent.companyId, runId, agent, context };
  const renderedPrompt = renderTemplate(promptTemplate, templateData);
  const handoff = asString(context.paperclipSessionHandoffMarkdown, "");
  const prompt = [handoff, renderedPrompt].filter(Boolean).join("\n\n");
  const runtimeEnv = buildRuntimeEnv(config, authMode);
  const loggedEnv = redactEnvForLogs(runtimeEnv);

  if (authMode === "api_key" && !apiKey) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "api_key auth mode requires config.apiKey or env.XAI_API_KEY",
      errorCode: "auth_required",
      provider: "xai",
      model,
      billingType: "api",
      costUsd: 0,
    };
  }

  if (onMeta) {
    await onMeta({
      adapterType: "grok_local",
      command: authMode === "api_key" && !command ? "xai-api" : command,
      cwd,
      commandArgs: authMode === "cli" ? ["-m", model] : ["authMode", authMode],
      commandNotes: [`Auth: ${authMode}`, `Model: ${model}`],
      env: loggedEnv,
      prompt,
      promptMetrics: { promptChars: prompt.length },
      context,
    });
  }

  await onLog("stdout", `[grok] authMode=${authMode} model=${model}\n`);

  // API-only fallback when CLI missing but api key present
  const { spawnSync } = await import("node:child_process");
  const which = spawnSync("sh", ["-lc", `command -v ${JSON.stringify(command)}`], { encoding: "utf8" });
  const cliAvailable = which.status === 0 && Boolean(which.stdout.trim());

  if (authMode === "api_key" && apiKey && !cliAvailable) {
    try {
      const api = await executeViaApi({ config, prompt, apiKey, onLog });
      const sessionId = `grok-api-${runId.slice(0, 8)}`;
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        errorMessage: null,
        usage: { inputTokens: api.inputTokens, outputTokens: api.outputTokens, cachedInputTokens: 0 },
        sessionId,
        sessionParams: { sessionId },
        sessionDisplayId: sessionId,
        provider: "xai",
        biller: "xai",
        model: api.model,
        billingType: "api",
        costUsd: 0,
        resultJson: { result: api.summary, model: api.model },
        summary: api.summary,
      };
    } catch (err: any) {
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: err?.message || "xAI API request failed",
        errorCode: "adapter_failed",
        provider: "xai",
        model,
        billingType: "api",
        costUsd: 0,
      };
    }
  }

  if (!cliAvailable) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: `Grok CLI not found (${command}). Install with: curl -fsSL https://x.ai/cli/install.sh | bash`,
      errorCode: "cli_missing",
      provider: "xai",
      model,
      billingType: authMode === "api_key" ? "api" : "subscription",
      costUsd: 0,
    };
  }

  const cli = await executeViaCli({
    runId,
    command,
    model,
    cwd,
    prompt,
    timeoutSec,
    runtimeEnv,
    onLog,
  });

  if (cli.timedOut) {
    return {
      exitCode: null,
      signal: cli.signal,
      timedOut: true,
      errorMessage: `Timeout after ${timeoutSec}s`,
      errorCode: "timeout",
      provider: "xai",
      model,
      billingType: authMode === "api_key" ? "api" : "subscription",
      costUsd: 0,
    };
  }

  if (cli.authFailed && authMode === "cli") {
    return {
      exitCode: cli.exitCode ?? 1,
      signal: cli.signal,
      timedOut: false,
      errorMessage: "Grok CLI not authenticated. Run `grok login` on the server or switch authMode to api_key.",
      errorCode: "auth_required",
      provider: "xai",
      model,
      billingType: "subscription",
      costUsd: 0,
    };
  }

  if ((cli.exitCode !== 0 || !cli.summary) && authMode === "api_key" && apiKey) {
    try {
      await onLog("stdout", "[grok] CLI failed, falling back to xAI API\n");
      const api = await executeViaApi({ config, prompt, apiKey, onLog });
      const sessionId = `grok-api-${runId.slice(0, 8)}`;
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        errorMessage: null,
        usage: { inputTokens: api.inputTokens, outputTokens: api.outputTokens, cachedInputTokens: 0 },
        sessionId,
        sessionParams: { sessionId },
        sessionDisplayId: sessionId,
        provider: "xai",
        biller: "xai",
        model: api.model,
        billingType: "api",
        costUsd: 0,
        resultJson: { result: api.summary, model: api.model },
        summary: api.summary,
      };
    } catch (apiErr: any) {
      const err = (cli.stderr || cli.summary || apiErr?.message || `Grok exited with code ${cli.exitCode}`).slice(0, 300);
      return {
        exitCode: cli.exitCode ?? 1,
        signal: cli.signal,
        timedOut: false,
        errorMessage: err,
        errorCode: "adapter_failed",
        provider: "xai",
        model,
        billingType: "api",
        costUsd: 0,
      };
    }
  }

  if (cli.exitCode !== 0 || !cli.summary) {
    const err = (cli.stderr || cli.summary || `Grok exited with code ${cli.exitCode}`).slice(0, 300);
    return {
      exitCode: cli.exitCode ?? 1,
      signal: cli.signal,
      timedOut: false,
      errorMessage: err,
      errorCode: "adapter_failed",
      provider: "xai",
      model,
      billingType: authMode === "api_key" ? "api" : "subscription",
      costUsd: 0,
    };
  }

  const sessionId = `grok-${runId.slice(0, 8)}`;
  return {
    exitCode: 0,
    signal: cli.signal,
    timedOut: false,
    errorMessage: null,
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    sessionId,
    sessionParams: { sessionId },
    sessionDisplayId: sessionId,
    provider: "xai",
    biller: "xai",
    model,
    billingType: authMode === "api_key" ? "api" : "subscription",
    costUsd: 0,
    resultJson: { result: cli.summary, model, authMode },
    summary: cli.summary,
  };
}
