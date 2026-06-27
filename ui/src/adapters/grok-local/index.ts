import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import type { TranscriptEntry, UIAdapterModule } from "../types";
import { GrokLocalConfigFields } from "./config-fields";

function parseGrokStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return [];
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (obj.type === "text" && typeof obj.data === "string") {
      return [{ kind: "stdout", ts, text: obj.data }];
    }
  } catch {
    return [];
  }
  return [];
}

type GrokCreateValues = CreateConfigValues & {
  authMode?: string;
  apiKey?: string;
};

export function buildGrokLocalConfig(v: GrokCreateValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.model) ac.model = v.model;
  if (v.command) ac.command = v.command;
  if (v.cwd) ac.cwd = v.cwd;
  if (v.promptTemplate) ac.promptTemplate = v.promptTemplate;
  ac.authMode = v.authMode ?? "cli";
  if (v.apiKey) ac.apiKey = v.apiKey;
  return ac;
}

export const grokLocalUIAdapter: UIAdapterModule = {
  type: "grok_local",
  label: "xAI Grok",
  parseStdoutLine: parseGrokStdoutLine,
  ConfigFields: GrokLocalConfigFields,
  buildAdapterConfig: buildGrokLocalConfig,
};