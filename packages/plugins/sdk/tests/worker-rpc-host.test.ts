import fs from "node:fs";
import os from "node:os";
import { PassThrough } from "node:stream";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "../src/define-plugin.js";
import type { JsonRpcResponse } from "../src/protocol.js";
import { isWorkerEntrypoint, startWorkerRpcHost } from "../src/worker-rpc-host.js";

function createWorkerHarness() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let buffer = "";
  const messages: JsonRpcResponse[] = [];
  const waiters = new Map<string | number | null, Array<(message: JsonRpcResponse) => void>>();

  stdout.setEncoding("utf8");
  stdout.on("data", (chunk) => {
    buffer += String(chunk);
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const message = JSON.parse(line) as JsonRpcResponse;
        const waiter = waiters.get(message.id)?.shift();
        if (waiter) {
          waiter(message);
        } else {
          messages.push(message);
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });

  async function request(method: string, params: unknown, id: string | number): Promise<JsonRpcResponse> {
    const existingIndex = messages.findIndex((message) => message.id === id);
    if (existingIndex >= 0) {
      return messages.splice(existingIndex, 1)[0]!;
    }
    const response = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 1_000);
      const wrappedResolve = (message: JsonRpcResponse) => {
        clearTimeout(timer);
        resolve(message);
      };
      const existing = waiters.get(id) ?? [];
      existing.push(wrappedResolve);
      waiters.set(id, existing);
    });
    stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return response;
  }

  return { stdin, stdout, request };
}

describe("isWorkerEntrypoint", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  function createTempRoot(): string {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-sdk-worker-"));
    tempRoots.push(tempRoot);
    return tempRoot;
  }

  it("matches an entrypoint reached through a symlinked directory", () => {
    const tempRoot = createTempRoot();
    const realDir = path.join(tempRoot, "real");
    const linkDir = path.join(tempRoot, "link");
    fs.mkdirSync(realDir);
    fs.symlinkSync(realDir, linkDir, "dir");

    const workerPath = path.join(realDir, "worker.js");
    fs.writeFileSync(workerPath, "");

    expect(
      isWorkerEntrypoint(
        path.join(linkDir, "worker.js"),
        pathToFileURL(workerPath).toString(),
      ),
    ).toBe(true);
  });

  it("does not match a different entrypoint", () => {
    const tempRoot = createTempRoot();
    const workerPath = path.join(tempRoot, "worker.js");
    const otherPath = path.join(tempRoot, "other.js");
    fs.writeFileSync(workerPath, "");
    fs.writeFileSync(otherPath, "");

    expect(
      isWorkerEntrypoint(
        otherPath,
        pathToFileURL(workerPath).toString(),
      ),
    ).toBe(false);
  });
});

describe("worker performAction context", () => {
  it("does not derive context companyId from caller params without host actor context", async () => {
    const harness = createWorkerHarness();
    const plugin = definePlugin({
      async setup(ctx) {
        ctx.actions.register("inspect", async (params, context) => ({
          paramsCompanyId: params.companyId,
          actor: context.actor,
          companyId: context.companyId,
        }));
      },
    });
    const host = startWorkerRpcHost({
      plugin,
      stdin: harness.stdin,
      stdout: harness.stdout,
    });

    try {
      const initialize = await harness.request("initialize", {
        manifest: {
          id: "paperclip.test-worker-context",
          apiVersion: 1,
          version: "1.0.0",
          displayName: "Worker Context Test",
          description: "Test plugin",
          author: "Paperclip",
          categories: ["automation"],
          capabilities: [],
          entrypoints: {},
        },
        config: {},
        databaseNamespace: null,
      }, 1);
      expect("result" in initialize ? initialize.result : null).toMatchObject({ ok: true });

      const response = await harness.request("performAction", {
        key: "inspect",
        params: { companyId: "spoofed-company" },
      }, 2);

      expect("result" in response ? response.result : null).toEqual({
        paramsCompanyId: "spoofed-company",
        actor: {
          type: "system",
          userId: null,
          agentId: null,
          runId: null,
          companyId: null,
        },
        companyId: null,
      });
    } finally {
      host.stop();
    }
  });
});
