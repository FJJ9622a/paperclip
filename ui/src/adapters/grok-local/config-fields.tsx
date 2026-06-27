import type { AdapterConfigFieldsProps } from "../types";
import { DraftInput, Field } from "../../components/agent-config-primitives";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

type GrokCreateValues = NonNullable<AdapterConfigFieldsProps["values"]> & {
  authMode?: string;
  apiKey?: string;
};

export function GrokLocalConfigFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
}: AdapterConfigFieldsProps) {
  const createValues = values as GrokCreateValues | null;
  const authMode = isCreate
    ? String(createValues?.authMode ?? "cli")
    : eff("adapterConfig", "authMode", String(config.authMode ?? "cli"));

  return (
    <>
      <Field
        label="Connection mode"
        hint="CLI uses grok login session (~/.grok). API key uses XAI_API_KEY for Grok CLI or direct xAI API."
      >
        <select
          className={inputClass}
          value={authMode}
          onChange={(e) => {
            const v = e.target.value;
            if (isCreate) {
              (set as (patch: Record<string, unknown>) => void)?.({ authMode: v });
            } else {
              mark("adapterConfig", "authMode", v);
            }
          }}
        >
          <option value="cli">Direct CLI (grok login session)</option>
          <option value="api_key">API key (XAI_API_KEY)</option>
        </select>
      </Field>

      {authMode === "api_key" && (
        <Field
          label="xAI API key"
          hint="Optional if XAI_API_KEY is set in environment variables below."
        >
          <DraftInput
            value={
              isCreate
                ? String(createValues?.apiKey ?? "")
                : eff("adapterConfig", "apiKey", String(config.apiKey ?? ""))
            }
            onCommit={(v) => {
              if (isCreate) {
                (set as (patch: Record<string, unknown>) => void)?.({ apiKey: v });
              } else {
                mark("adapterConfig", "apiKey", v || undefined);
              }
            }}
            immediate
            className={inputClass}
            placeholder="xai-..."
          />
        </Field>
      )}

      <Field label="Grok CLI path" hint="Default: grok (from PATH).">
        <DraftInput
          value={
            isCreate
              ? String(createValues?.command ?? "")
              : eff("adapterConfig", "command", String(config.command ?? ""))
          }
          onCommit={(v) => {
            if (isCreate) set?.({ command: v });
            else mark("adapterConfig", "command", v || undefined);
          }}
          immediate
          className={inputClass}
          placeholder="grok"
        />
      </Field>
    </>
  );
}