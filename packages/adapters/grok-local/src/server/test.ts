import { spawnSync } from "node:child_process";
import { DEFAULT_GROK_AUTH_MODE, DEFAULT_GROK_COMMAND } from "../index.js";

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}
function parseObject(v: unknown): Record<string, unknown> {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}
function resolveAuthMode(config: Record<string, unknown>): "cli" | "api_key" {
  const mode = asString(config.authMode, DEFAULT_GROK_AUTH_MODE).toLowerCase();
  return mode === "api_key" ? "api_key" : "cli";
}
function resolveApiKey(config: Record<string, unknown>): string {
  const direct = asString(config.apiKey, "");
  if (direct) return direct;
  const env = parseObject(config.env);
  return asString(env.XAI_API_KEY, "") || asString(env.GROK_API_KEY, "");
}

export async function testEnvironment(config: Record<string, unknown> = {}) {
  const command = asString(config.command, DEFAULT_GROK_COMMAND);
  const authMode = resolveAuthMode(config);
  const apiKey = resolveApiKey(config);

  if (authMode === "api_key") {
    if (!apiKey) {
      return {
        ok: false,
        message: "API key auth selected but no key configured",
        hint: "Set adapterConfig.apiKey or add XAI_API_KEY in environment variables.",
      };
    }
    const probe = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (probe.ok) {
      return {
        ok: true,
        message: "xAI API key is valid",
        details: { authMode, api: "https://api.x.ai/v1" },
      };
    }
    const body = await probe.text();
    return {
      ok: false,
      message: `xAI API key check failed (${probe.status})`,
      hint: "Verify the API key at https://console.x.ai",
      details: { authMode, response: body.slice(0, 200) },
    };
  }

  const which = spawnSync("sh", ["-lc", `command -v ${JSON.stringify(command)}`], { encoding: "utf8" });
  if (which.status !== 0 || !which.stdout.trim()) {
    return {
      ok: false,
      message: `Grok CLI not found (${command})`,
      hint: "Install: curl -fsSL https://x.ai/cli/install.sh | bash",
    };
  }

  const runtimeEnv = { ...process.env, HOME: process.env.HOME || "/paperclip" };
  const version = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 15000, env: runtimeEnv });
  const models = spawnSync(command, ["models"], { encoding: "utf8", timeout: 20000, env: runtimeEnv });
  const combined = `${models.stdout}\n${models.stderr}`;
  const authOk = !/not authenticated/i.test(combined);
  return {
    ok: authOk,
    message: authOk ? `Grok CLI ready (${which.stdout.trim()})` : "Grok CLI found but not authenticated",
    hint: authOk ? undefined : "Run `grok login` on the server, or switch authMode to api_key.",
    details: {
      authMode,
      command: which.stdout.trim(),
      version: (version.stdout || version.stderr || "").trim().slice(0, 200),
      modelsPreview: combined.trim().slice(0, 400),
    },
  };
}
