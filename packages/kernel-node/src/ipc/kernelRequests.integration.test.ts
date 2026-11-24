// Tests the requests through a NodeKernel and a real child: bridge calls (BridgeCallFailed for a throw), snapshots,
// bindings with and without values, a route request, concurrent requests settled by id in the order the kernel answers
// them, aborted requests (rejected with the signal's reason, their late results ignored, never sent when aborted
// before), and a call whose flow an interrupt terminated, which only its signal settles (04-kernel §2.1, §6).
import { encodeStrict } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "../fixtures/kernelWorld.js";
import { cellBook } from "../fixtures/realmHarness.js";

const book = cellBook({
  api: [
    "export function add(a: number, b: number) { return a + b }",
    "export const data = { n: 1 }",
    "export function fails() { throw new Error('no') }",
    "export const slow = () => new Promise((resolve) => setTimeout(() => resolve(1), 20))", // tested behaviour
    "route('POST /echo', async (req: Request) => ({ got: await req.text() }))",
  ].join("\n"),
  spinner: "export function spin() { display.html('spinning'); while (true) {} }",
  counter: "let counted = 0\nexport function count() { counted += 1; return counted }",
  gated: [
    "let open: () => void = () => undefined",
    "const gate = new Promise<void>((resolve) => (open = resolve))",
    'export async function wait() { await gate; return "released" }',
    "export function release() { open() }",
  ].join("\n"),
});

beforeAll(() => {
  book.compile(compileCell);
});

/** The wire form of a call's argument array (05-bridge §9). */
function wire(args: readonly unknown[]): readonly unknown[] {
  const encoded = encodeStrict(args);
  if (!encoded.ok) throw new Error("not transferable");
  return encoded.json as readonly unknown[];
}

describe("bridge and scope requests through a real kernel", () => {
  it("answers bridge calls, a throwing one with BridgeCallFailed", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("api"));
      expect(await kernel.call("add", wire([2, 3]))).toEqual({ value: 5, redacted: false });
      await expect(kernel.call("fails", wire([]))).rejects.toMatchObject({
        name: "BridgeCallFailed",
        data: { error: { name: "Error", message: "no" } },
      });
    });
  });

  it("answers snapshots and bindings, and fails a snapshot of a name that is not exported", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("api"));
      expect(await kernel.snapshot(["add", "data"])).toEqual({
        add: { kind: "fn" },
        data: { kind: "value", json: { n: 1 } },
      });
      await expect(kernel.snapshot(["nope"])).rejects.toMatchObject({
        name: "KernelRequestFailed",
        data: {
          request: "snapshot",
          error: { name: "ReferenceError", message: "nope is not a current export" },
        },
      });
      const bindings = await kernel.bindings();
      expect(bindings.map(({ name, kind }) => `${kind} ${name}`).sort()).toEqual([
        ...["const data", "const slow", "function add", "function fails"],
      ]);
      const [data] = await kernel.bindings({ names: ["data"], full: true });
      expect(data).toMatchObject({
        name: "data",
        json: { n: 1 },
        repr: "{ n: 1 }",
        exported: true,
      });
    });
  });
});

describe("a call the kernel refuses", () => {
  it("rejects a call the kernel refused before running anything with CallRefused, saying why", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("api"));
      await expect(kernel.call("nope", wire([]))).rejects.toMatchObject({
        name: "CallRefused",
        data: { reason: "missing", error: { name: "ReferenceError" } },
      });
      await expect(kernel.call("data", wire([]))).rejects.toMatchObject({
        name: "CallRefused",
        data: { reason: "value", error: { name: "TypeError", message: "data is not a function" } },
      });
    });
  });
});

describe("concurrent requests through a real kernel", () => {
  it("settles each request with the result of its id, in the order the kernel answers them", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("api"));
      await run(book.cell("gated"));
      const order: string[] = [];
      const waiting = kernel.call("wait", wire([])).finally(() => order.push("wait"));
      expect(await kernel.call("add", wire([2, 3]))).toEqual({ value: 5, redacted: false });
      order.push("add");
      await kernel.call("release", wire([]));
      expect(await waiting).toEqual({ value: "released", redacted: false });
      expect(order).toEqual(["add", "wait"]);
    });
  });
});

describe("route requests through a real kernel", () => {
  it("serves a route request through its handler", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("api"));
      const rawBody = Buffer.from("ping").toString("base64");
      const headers = { "content-type": "text/plain" };
      const request = { method: "POST", path: "/echo", search: "", headers, rawBody };
      const response = await kernel.handleRoute(request);
      expect(response.status).toBe(200);
      expect(JSON.parse(Buffer.from(response.body, "base64").toString())).toEqual({ got: "ping" });
    });
  });
});

describe("aborted requests through a real kernel", () => {
  it("rejects an aborted call at once with the signal's reason and ignores its late result", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("api"));
      const controller = new AbortController();
      const aborted = kernel.call("slow", wire([]), { signal: controller.signal });
      controller.abort();
      await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
      const navigation = new AbortController();
      const reason = new Error("navigated away");
      const navigated = kernel.call("slow", wire([]), { signal: navigation.signal });
      navigation.abort(reason);
      await expect(navigated).rejects.toBe(reason);
      expect(await kernel.call("slow", wire([]))).toEqual({ value: 1, redacted: false });
    });
  });

  it("rejects an aborted snapshot and bindings request at once and answers the next ones", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("api"));
      const controller = new AbortController();
      const { signal } = controller;
      const snapshot = kernel.snapshot(["data"], { signal });
      const bindings = kernel.bindings({ names: ["data"], full: true }, { signal });
      controller.abort();
      await expect(snapshot).rejects.toMatchObject({ name: "AbortError" });
      await expect(bindings).rejects.toMatchObject({ name: "AbortError" });
      expect(await kernel.snapshot(["data"])).toEqual({ data: { kind: "value", json: { n: 1 } } });
      expect(await kernel.bindings({ names: ["data"] })).toMatchObject([{ name: "data" }]);
    });
  });
});

describe("requests aborted before they are sent", () => {
  it("never sends a call whose signal had already aborted, a reason that is not an Error wrapped", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("counter"));
      await expect(
        kernel.call("count", wire([]), { signal: AbortSignal.abort() }),
      ).rejects.toMatchObject({ name: "AbortError" });
      const slow = AbortSignal.abort("too slow");
      await expect(kernel.call("count", wire([]), { signal: slow })).rejects.toMatchObject({
        name: "AbortError",
        message: "too slow",
      });
      expect(await kernel.call("count", wire([]))).toEqual({ value: 1, redacted: false });
    });
  });
});

describe("a request whose flow an interrupt terminated", () => {
  it("is left to its signal, and the kernel answers the next ones", async () => {
    await withKernel(async ({ kernel, run, until }) => {
      await run(book.cell("api"));
      await run(book.cell("spinner"));
      const controller = new AbortController();
      let settled = false;
      const spinning = kernel.call("spin", wire([]), { signal: controller.signal });
      spinning.finally(() => (settled = true)).catch(() => undefined);
      await until(({ late }) => late.some(({ output }) => output.kind === "display"));
      await kernel.interrupt();
      expect(await kernel.call("add", wire([2, 3]))).toEqual({ value: 5, redacted: false });
      expect(settled).toBe(false);
      controller.abort();
      await expect(spinning).rejects.toMatchObject({ name: "AbortError" });
    });
  });
});
