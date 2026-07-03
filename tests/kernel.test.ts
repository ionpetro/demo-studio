import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { kernelClient, createKernelBrowser, deleteKernelBrowser } from "../src/engine/kernel.ts";

describe("kernel.ts (no live Kernel access - env-unset paths only)", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.KERNEL_API_KEY;
    delete process.env.KERNEL_API_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.KERNEL_API_KEY;
    else process.env.KERNEL_API_KEY = savedKey;
  });

  test("kernelClient() throws when KERNEL_API_KEY is unset", () => {
    assert.throws(() => kernelClient(), /KERNEL_API_KEY is not set/);
  });

  test("createKernelBrowser() rejects with the same message, without attempting a network call", async () => {
    await assert.rejects(
      () => createKernelBrowser(),
      /KERNEL_API_KEY is not set/,
    );
  });

  test("createKernelBrowser() rejects even when a viewport is passed", async () => {
    await assert.rejects(
      () => createKernelBrowser({ width: 1280, height: 800 }),
      /KERNEL_API_KEY is not set/,
    );
  });

  test("deleteKernelBrowser() swallows the kernelClient() error internally and resolves (best-effort cleanup)", async () => {
    // Source: `try { await kernelClient().browsers.deleteByID(sessionId); } catch {}`
    // kernelClient() throws synchronously *inside* the try block, so the
    // catch swallows it and the function resolves with undefined rather
    // than rejecting.
    await assert.doesNotReject(() => deleteKernelBrowser("some-session-id"));
    const result = await deleteKernelBrowser("some-session-id");
    assert.equal(result, undefined);
  });
});
