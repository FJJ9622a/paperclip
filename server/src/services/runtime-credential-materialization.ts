import type { AdapterRuntimeCredentialFile, AdapterRuntimeCredentialMaterialization } from "@paperclipai/adapter-utils/execution-target";
import type { Db } from "@paperclipai/db";
import type { SubscriptionCredentialKind } from "@paperclipai/shared";
import { HttpError } from "../errors.js";
import {
  subscriptionCredentialService,
  type DecryptedSubscriptionCredential,
} from "./subscription-credentials.js";

export type ByoSubscriptionCredentialProvider = "claude" | "codex";

export type ByoSubscriptionCredentialMaterial =
  | {
      provider: "claude";
      kind: "oauth_token";
      value: string;
    }
  | {
      provider: "claude";
      kind: "credentials_json";
      value: string;
    }
  | {
      provider: "codex";
      kind: "auth_json";
      value: string;
    };

export interface ByoSubscriptionCredentialStore {
  resolveForRuntime(input: {
    companyId: string;
    userId: string;
    provider: ByoSubscriptionCredentialProvider;
    agentId?: string | null;
    issueId?: string | null;
    heartbeatRunId?: string | null;
  }): Promise<ByoSubscriptionCredentialMaterial | null>;
}

function materialKindFromStoredCredential(
  provider: ByoSubscriptionCredentialProvider,
  credentialKind: SubscriptionCredentialKind,
): ByoSubscriptionCredentialMaterial["kind"] | null {
  switch (credentialKind) {
    case "claude_oauth_token":
      return provider === "claude" ? "oauth_token" : null;
    case "claude_credentials_json":
      return provider === "claude" ? "credentials_json" : null;
    case "codex_auth_json":
      return provider === "codex" ? "auth_json" : null;
  }
}

export function byoSubscriptionCredentialMaterialFromDecrypted(
  credential: Pick<DecryptedSubscriptionCredential, "provider" | "credentialKind" | "material">,
): ByoSubscriptionCredentialMaterial | null {
  const provider = providerForSubscriptionCredentialAdapter(`${credential.provider}_local`);
  if (!provider || provider !== credential.provider) return null;
  const kind = materialKindFromStoredCredential(provider, credential.credentialKind as SubscriptionCredentialKind);
  if (!kind) return null;
  return {
    provider,
    kind,
    value: credential.material,
  } as ByoSubscriptionCredentialMaterial;
}

export function createSubscriptionCredentialRuntimeStore(db: Db): ByoSubscriptionCredentialStore {
  const credentials = subscriptionCredentialService(db);
  return {
    async resolveForRuntime(input) {
      try {
        const credential = await credentials.resolveDecryptedMaterial(
          input.companyId,
          input.userId,
          input.provider,
        );
        return byoSubscriptionCredentialMaterialFromDecrypted(credential);
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) {
          return null;
        }
        throw err;
      }
    },
  };
}

function runtimeCredentialFile(relativePath: string, contents: string): AdapterRuntimeCredentialFile {
  return {
    relativePath,
    contents,
    mode: 0o600,
  };
}

export function providerForSubscriptionCredentialAdapter(adapterType: string | null | undefined): ByoSubscriptionCredentialProvider | null {
  switch (adapterType) {
    case "claude_local":
      return "claude";
    case "codex_local":
      return "codex";
    default:
      return null;
  }
}

export function buildByoSubscriptionRuntimeCredentialMaterialization(
  material: ByoSubscriptionCredentialMaterial,
): AdapterRuntimeCredentialMaterialization {
  switch (material.kind) {
    case "oauth_token":
      return {
        provider: material.provider,
        env: {
          CLAUDE_CODE_OAUTH_TOKEN: material.value,
        },
      };
    case "credentials_json":
      return {
        provider: material.provider,
        assets: {
          "config-seed": {
            files: [runtimeCredentialFile(".credentials.json", material.value)],
          },
        },
      };
    case "auth_json":
      return {
        provider: material.provider,
        assets: {
          home: {
            files: [runtimeCredentialFile("auth.json", material.value)],
          },
        },
      };
  }
}

export async function resolveByoSubscriptionRuntimeCredentialMaterialization(input: {
  store?: ByoSubscriptionCredentialStore | null;
  companyId: string;
  userId?: string | null;
  provider: ByoSubscriptionCredentialProvider | null;
  agentId?: string | null;
  issueId?: string | null;
  heartbeatRunId?: string | null;
}): Promise<AdapterRuntimeCredentialMaterialization | null> {
  if (!input.store || !input.provider || !input.userId) return null;

  const material = await input.store.resolveForRuntime({
    companyId: input.companyId,
    userId: input.userId,
    provider: input.provider,
    agentId: input.agentId ?? null,
    issueId: input.issueId ?? null,
    heartbeatRunId: input.heartbeatRunId ?? null,
  });
  if (!material || material.provider !== input.provider) return null;

  return buildByoSubscriptionRuntimeCredentialMaterialization(material);
}
