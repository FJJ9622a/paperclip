import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AdapterRuntimeCredentialFile {
  /**
   * POSIX-style path relative to the runtime asset root.
   */
  relativePath: string;
  contents: string;
  /**
   * File mode for credential material. Defaults to 0600.
   */
  mode?: number;
}

export interface AdapterRuntimeCredentialAsset {
  files: AdapterRuntimeCredentialFile[];
}

export type AdapterRuntimeCredentialProvider = "claude" | "codex" | (string & {});

export interface AdapterRuntimeCredentialMaterialization {
  provider?: AdapterRuntimeCredentialProvider | null;
  /**
   * Environment variables injected only into the adapter invocation process.
   */
  env?: Record<string, string>;
  /**
   * Credential files keyed by managed runtime asset name, e.g. "home" for
   * Codex or "config-seed" for Claude.
   */
  assets?: Record<string, AdapterRuntimeCredentialAsset>;
}

export interface AdapterRuntimeCredentialMaterializationHost {
  runtimeCredentialMaterialization?: AdapterRuntimeCredentialMaterialization | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRelativePath(relativePath: string): string {
  const raw = relativePath.trim().replaceAll("\\", "/");
  if (path.posix.isAbsolute(raw)) {
    throw new Error(`Invalid runtime credential relative path: ${relativePath}`);
  }
  const normalized = path.posix.normalize(raw);
  const parts = normalized.split("/").filter(Boolean);
  if (
    parts.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid runtime credential relative path: ${relativePath}`);
  }
  return parts.join("/");
}

function parseRuntimeCredentialFile(value: unknown): AdapterRuntimeCredentialFile | null {
  if (!isObject(value) || typeof value.relativePath !== "string" || typeof value.contents !== "string") {
    return null;
  }
  const relativePath = normalizeRelativePath(value.relativePath);
  const mode = typeof value.mode === "number" && Number.isInteger(value.mode) && value.mode > 0 ? value.mode : undefined;
  return {
    relativePath,
    contents: value.contents,
    ...(mode ? { mode } : {}),
  };
}

export function normalizeAdapterRuntimeCredentialMaterialization(value: unknown): AdapterRuntimeCredentialMaterialization | null {
  if (!isObject(value)) return null;

  const provider = typeof value.provider === "string" && value.provider.trim().length > 0 ? value.provider.trim() : null;
  const env = isObject(value.env)
    ? Object.fromEntries(Object.entries(value.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};

  const assets: Record<string, AdapterRuntimeCredentialAsset> = {};
  if (isObject(value.assets)) {
    for (const [assetKey, assetValue] of Object.entries(value.assets)) {
      if (!/^[a-zA-Z0-9_-]+$/.test(assetKey) || !isObject(assetValue) || !Array.isArray(assetValue.files)) {
        continue;
      }
      const files = assetValue.files.map(parseRuntimeCredentialFile).filter((file): file is AdapterRuntimeCredentialFile => file !== null);
      if (files.length > 0) {
        assets[assetKey] = { files };
      }
    }
  }

  return Object.keys(env).length > 0 || Object.keys(assets).length > 0
    ? {
        ...(provider ? { provider } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
        ...(Object.keys(assets).length > 0 ? { assets } : {}),
      }
    : null;
}

export function getAdapterRuntimeCredentialMaterialization(
  target: AdapterRuntimeCredentialMaterializationHost | null | undefined,
): AdapterRuntimeCredentialMaterialization | null {
  return normalizeAdapterRuntimeCredentialMaterialization(target?.runtimeCredentialMaterialization);
}

export function adapterRuntimeCredentialEnv(
  target: AdapterRuntimeCredentialMaterializationHost | null | undefined,
): Record<string, string> {
  return getAdapterRuntimeCredentialMaterialization(target)?.env ?? {};
}

export function adapterRuntimeCredentialAssetFiles(
  target: AdapterRuntimeCredentialMaterializationHost | null | undefined,
  assetKey: string,
): AdapterRuntimeCredentialFile[] {
  return getAdapterRuntimeCredentialMaterialization(target)?.assets?.[assetKey]?.files ?? [];
}

export function hasAdapterRuntimeCredentialAssetFiles(
  target: AdapterRuntimeCredentialMaterializationHost | null | undefined,
  assetKey: string,
): boolean {
  return adapterRuntimeCredentialAssetFiles(target, assetKey).length > 0;
}

async function copyDirectoryForRuntimeCredentialOverlay(input: { sourceDir: string | null | undefined; targetDir: string }) {
  await fs.mkdir(input.targetDir, { recursive: true });
  if (!input.sourceDir) return;
  const stat = await fs.stat(input.sourceDir).catch(() => null);
  if (!stat?.isDirectory()) return;
  await fs.cp(input.sourceDir, input.targetDir, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
}

async function writeCredentialFiles(rootDir: string, files: AdapterRuntimeCredentialFile[]) {
  for (const file of files) {
    const relativePath = normalizeRelativePath(file.relativePath);
    const target = path.join(rootDir, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rm(target, { force: true, recursive: true }).catch(() => undefined);
    await fs.writeFile(target, file.contents, {
      encoding: "utf8",
      mode: file.mode ?? 0o600,
    });
    await fs.chmod(target, file.mode ?? 0o600).catch(() => undefined);
  }
}

export interface MaterializedRuntimeCredentialAsset {
  localDir: string;
  materialized: boolean;
  cleanup(): Promise<void>;
}

export async function materializeAdapterRuntimeCredentialAsset(input: {
  baseDir?: string | null;
  files: AdapterRuntimeCredentialFile[];
  tempPrefix?: string;
}): Promise<MaterializedRuntimeCredentialAsset> {
  if (input.files.length === 0) {
    return {
      localDir: input.baseDir ?? "",
      materialized: false,
      cleanup: async () => {},
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), input.tempPrefix ?? "paperclip-runtime-credentials-"));
  try {
    await copyDirectoryForRuntimeCredentialOverlay({
      sourceDir: input.baseDir,
      targetDir: tempDir,
    });
    await writeCredentialFiles(tempDir, input.files);
  } catch (err) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  return {
    localDir: tempDir,
    materialized: true,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
