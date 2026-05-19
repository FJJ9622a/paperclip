import { describe, expect, it } from "vitest";
import { isDatabaseConnectionUnavailableError } from "../app.js";

describe("feedback export flush error classification", () => {
  it("recognizes wrapped database connection-refused errors", () => {
    const error = new Error("Failed query: select ...: connect ECONNREFUSED 127.0.0.1:54329");
    (error as { cause?: unknown }).cause = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:54329"),
      { code: "ECONNREFUSED" },
    );

    expect(isDatabaseConnectionUnavailableError(error)).toBe(true);
  });

  it("does not classify ordinary feedback upload failures as database outages", () => {
    expect(isDatabaseConnectionUnavailableError(new Error("upstream returned 500"))).toBe(false);
  });
});
