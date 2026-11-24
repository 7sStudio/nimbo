// Tests the async stub of 05-bridge §2 and §4: strict encoding of the arguments, decoding, failures, redaction.
import { ArgumentNotSerializable, BridgeCallFailed, KernelDead, decode } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import type { BridgeHandler } from "../fixtures/transport.js";
import { createTestTransport } from "../fixtures/transport.js";
import type { StubContext } from "./stub.js";
import { createStub } from "./stub.js";

const contextFor = (bridge: BridgeHandler, redacted: string[] = []): StubContext => ({
  notebook: "demo.jsnb",
  transport: createTestTransport({ bridge }),
  rpcTimeoutMs: 60_000,
  maxBytesPerValue: 16,
  onRedacted: (fn) => redacted.push(fn),
  pauses: { paused: () => false, heldMs: () => 0 },
});

describe("a stub's request", () => {
  it("sends the arguments array encoded once, so a shared reference survives", async () => {
    let sent: readonly unknown[] = [];
    const stub = createStub(
      "pair",
      contextFor((_fn, args) => ((sent = args), { result: null })),
    );
    const shared = { id: 1 };
    await stub(shared, shared);
    expect(sent).toEqual([{ id: 1 }, { $type: "ref", path: [0] }]);
    const [first, second] = decode(sent) as unknown[];
    expect(second).toBe(first);
  });

  it("names the function and the notebook in bridge.call", async () => {
    const transport = createTestTransport({ bridge: () => ({ result: 1 }) });
    const stub = createStub("f", { ...contextFor(() => 0), transport });
    await stub(2000);
    expect(transport.calls).toEqual([
      { method: "bridge.call", params: { notebook: "demo.jsnb", fn: "f", args: [2000] } },
    ]);
  });

  it("rejects ArgumentNotSerializable with the argument's index before anything is sent", async () => {
    const transport = createTestTransport({ bridge: () => ({ result: 1 }) });
    const stub = createStub("createIntent", { ...contextFor(() => 0), transport });
    const error = await stub(1, document.createElement("div")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArgumentNotSerializable);
    expect((error as ArgumentNotSerializable).message).toBe(
      "Argument 2 of createIntent(...) is an HTMLDivElement and cannot be sent to the server.",
    );
    const tooBig = (await stub(new Uint8Array(17)).catch((e: unknown) => e)) as Error;
    expect(tooBig.name).toBe("ArgumentNotSerializable");
    expect(tooBig.message).toBe(
      "Argument 1 of createIntent(...) is a Uint8Array of 17 bytes, more than bridge.maxBytesPerValue (16 bytes) lets cross. Raise the setting, or send it in parts.",
    );
    expect(transport.calls).toEqual([]);
  });
});

/** A stub whose server answers `answer` to every call. */
const answering = (answer: unknown, redacted: string[] = []) =>
  createStub(
    "createIntent",
    contextFor(() => answer, redacted),
  );

describe("a stub's answer", () => {
  it("decodes the result into real Dates, Maps, BigInts and bytes", async () => {
    const at = { $type: "date", iso: "2026-10-12T00:00:00.000Z" };
    const result = [
      { $type: "map", entries: [["at", at]] },
      { $type: "bigint", value: "9" },
    ];
    const [map, big] = (await answering({ result })()) as [Map<string, Date>, bigint];
    expect(map.get("at")).toEqual(new Date("2026-10-12T00:00:00.000Z"));
    expect(big).toBe(9n);
    const bytes = { $type: "bytes", length: 2, base64: "AQI=" };
    expect(await answering({ result: bytes })()).toEqual(new Uint8Array([1, 2]));
  });

  it("refuses an answer that is not a bridge.call result", async () => {
    await expect(answering("nonsense")()).rejects.toThrow();
  });

  it("reports a redacted result on the calling run and still resolves with it", async () => {
    const redacted: string[] = [];
    expect(await answering({ result: "***", redacted: true }, redacted)()).toBe("***");
    expect(redacted).toEqual(["createIntent"]);
  });

  it("answers concurrent calls independently", async () => {
    const echo = contextFor((_fn, [value]) => Promise.resolve({ result: value }));
    const stub = createStub("echo", echo);
    expect(await Promise.all([stub(1), stub(2), stub(3)])).toEqual([1, 2, 3]);
  });
});

describe("a stub's failure", () => {
  it("rejects with the server's error rebuilt from BRIDGE_CALL_FAILED", async () => {
    const info = { name: "TypeError", message: "boom", frames: [], raw: "TypeError: boom" };
    const failing = createStub(
      "f",
      contextFor(() => Promise.reject(new BridgeCallFailed({ error: info }))),
    );
    const error = (await failing().catch((e: unknown) => e)) as Error;
    expect([error.name, error.message, error.cause]).toEqual([
      "TypeError",
      "boom",
      { frames: [], raw: info.raw },
    ]);
  });

  it("rejects with any other call failure as it came", async () => {
    const dead = new KernelDead({ exitCode: 1 });
    expect(
      await createStub(
        "f",
        contextFor(() => Promise.reject(dead)),
      )().catch((e: unknown) => e),
    ).toBe(dead);
  });
});
