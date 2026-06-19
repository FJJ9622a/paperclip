export type BuildInfo = {
  commitSha: string;
  builtAt: string;
};

const fallbackBuildInfo: BuildInfo = {
  commitSha: "unknown",
  builtAt: "unknown",
};

async function loadBuildInfo(): Promise<BuildInfo> {
  try {
    const generatedModule = "./build-info.generated.js";
    const imported = await import(generatedModule) as {
      buildInfo?: Partial<BuildInfo>;
    };
    return {
      commitSha: imported.buildInfo?.commitSha ?? fallbackBuildInfo.commitSha,
      builtAt: imported.buildInfo?.builtAt ?? fallbackBuildInfo.builtAt,
    };
  } catch {
    return fallbackBuildInfo;
  }
}

export const buildInfo = await loadBuildInfo();
