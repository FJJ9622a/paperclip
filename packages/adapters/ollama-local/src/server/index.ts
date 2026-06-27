export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export const sessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const sid = typeof r.sessionId === "string" && r.sessionId.trim() ? r.sessionId.trim() : null;
    return sid ? { sessionId: sid } : null;
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params) return null;
    const sid = typeof params.sessionId === "string" && params.sessionId.trim() ? params.sessionId.trim() : null;
    return sid ? { sessionId: sid } : null;
  },
  getDisplayId(params: Record<string, unknown> | null) {
    if (!params) return null;
    return typeof params.sessionId === "string" ? params.sessionId.trim() || null : null;
  },
};
