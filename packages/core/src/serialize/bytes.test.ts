// Tests the base64 codec and the typed-array views.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { bytesOf, fromBase64, toBase64 } from "./bytes.js";

describe("toBase64", () => {
  it("pads one and two trailing bytes", () => {
    expect(toBase64(new Uint8Array([]))).toBe("");
    expect(toBase64(new Uint8Array([104]))).toBe("aA==");
    expect(toBase64(new Uint8Array([104, 105]))).toBe("aGk=");
    expect(toBase64(new Uint8Array([104, 105, 33]))).toBe("aGkh");
  });

  it("round-trips random bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect(fromBase64(toBase64(bytes))).toEqual(bytes);
      }),
      { numRuns: 30 },
    );
  });
});

describe("fromBase64", () => {
  it("ignores characters outside the alphabet", () => {
    expect(fromBase64("aG\nk=")).toEqual(new Uint8Array([104, 105]));
  });
});

describe("bytesOf", () => {
  it("views typed arrays, DataViews and ArrayBuffers over the same memory", () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(bytesOf(buffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(bytesOf(new Uint16Array(buffer, 2, 1))).toEqual(new Uint8Array([3, 4]));
    expect(bytesOf(new DataView(buffer, 1, 2))).toEqual(new Uint8Array([2, 3]));
    expect(bytesOf({})).toBeUndefined();
  });
});
