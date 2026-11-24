// Tests the stdio patch: text taken under a store, text passed through without one, the log bypass, restore.
import { describe, expect, it } from "vitest";

import type { PatchableStream, StartLater } from "./stdio.js";
import { patchStdio } from "./stdio.js";

/** Starts a write callback in a promise job, as the kernel starts user code. */
const later: StartLater = (job) => {
  void Promise.resolve().then(job);
};

/** A fake stream whose prototype owns `write`, like a real one. */
const fakeStream = () => {
  const written: unknown[][] = [];
  const proto = {
    write(chunk: string | Uint8Array, ...rest: unknown[]): boolean {
      written.push([chunk, ...rest]);
      return true;
    },
  };
  const stream: PatchableStream = Object.create(proto) as PatchableStream;
  return { stream, written };
};

describe("patchStdio", () => {
  it("hands text to take when it accepts and to the original stream when it does not", () => {
    const out = fakeStream();
    const err = fakeStream();
    const taken: string[] = [];
    let accept = true;
    patchStdio(
      { stdout: out.stream, stderr: err.stream },
      (stream, text) => {
        taken.push(`${stream}:${text}`);
        return accept;
      },
      later,
    );
    out.stream.write("one");
    err.stream.write(new TextEncoder().encode("two"));
    accept = false;
    out.stream.write("three", "utf8");
    expect(taken).toEqual(["stdout:one", "stderr:two", "stdout:three"]);
    expect(out.written).toEqual([["three", "utf8"]]);
  });
});

describe("patchStdio write callbacks and restore", () => {
  it("calls the write callback of a taken write", async () => {
    const out = fakeStream();
    patchStdio({ stdout: out.stream, stderr: fakeStream().stream }, () => true, later);
    await new Promise<void>((resolve) => {
      out.stream.write("x", () => {
        resolve();
      });
    });
    expect(out.written).toEqual([]);
  });

  it("logs past the patch and restores the original write", () => {
    const out = fakeStream();
    const err = fakeStream();
    const own = (chunk: string | Uint8Array): boolean => err.written.push(["own", chunk]) > 0;
    err.stream.write = own;
    const patched = patchStdio({ stdout: out.stream, stderr: err.stream }, () => true, later);
    patched.log("stdout", "line\n");
    patched.restore();
    expect(out.written).toEqual([["line\n"]]);
    expect(Object.hasOwn(out.stream, "write")).toBe(false);
    expect(Object.getOwnPropertyDescriptor(err.stream, "write")?.value).toBe(own);
  });
});
