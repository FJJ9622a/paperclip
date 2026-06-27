import { DEFAULT_OLLAMA_URL } from "../index.js";

function asString(v: unknown, fb: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fb;
}
function parseObject(v: unknown): Record<string, unknown> {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

export async function testEnvironment(ctx: any): Promise<any> {
  const config = parseObject(ctx.config);
  const url = asString(config.url, DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  const model = asString(config.model, "");
  const checks: any[] = [];

  try {
    const res = await fetch(url + "/api/tags", { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      const names = (data.models || []).map((m: any) => m.name);
      checks.push({ code: "ollama_reachable", level: "info", message: "Ollama OK (" + names.length + " models)" });
      if (model) {
        const found = names.some((n: string) => n === model || n.startsWith(model.split(":")[0]));
        checks.push(found
          ? { code: "model_ok", level: "info", message: "Model " + model + " available" }
          : { code: "model_missing", level: "error", message: "Model " + model + " not found" });
      }
    } else {
      checks.push({ code: "ollama_error", level: "error", message: "HTTP " + res.status });
    }
  } catch (err: any) {
    checks.push({ code: "ollama_down", level: "error", message: "Cannot connect: " + (err.message || err) });
  }
  return { adapterType: "ollama", status: checks.some((c: any) => c.level === "error") ? "fail" : "pass", checks, testedAt: new Date().toISOString() };
}
