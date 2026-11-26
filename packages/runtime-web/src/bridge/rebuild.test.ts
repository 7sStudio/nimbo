// Tests the rebuilt server errors: name, message, data, the server stack as `cause`.
import { ApiError, BridgeCallFailed, JsnbError } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { rebuildError, stubFailure } from "./rebuild.js";

const info = {
  name: "CardDeclined",
  message: "Your card was declined.",
  frames: [{ cell: "c_d4e5f6", line: 3, col: 9 }],
  raw: "CardDeclined: Your card was declined.\n    at createIntent (jsnb:///demo.jsnb/c_d4e5f6.ts:3:9)",
  data: { code: "card_declined" },
};

describe("rebuildError", () => {
  it("keeps the server's name, message and data, with the frames and raw stack as cause", () => {
    const error = rebuildError(info);
    expect(error).toBeInstanceOf(JsnbError);
    expect(error.name).toBe("CardDeclined");
    expect(error.message).toBe("Your card was declined.");
    expect(error.data).toEqual({ code: "card_declined" });
    expect(error.cause).toEqual({ frames: info.frames, raw: info.raw });
  });

  it("leaves data empty when the ErrorInfo has none", () => {
    const plain = { name: info.name, message: info.message, frames: [], raw: "" };
    expect(rebuildError(plain).data).toEqual({});
  });
});

describe("stubFailure", () => {
  it("rebuilds a BRIDGE_CALL_FAILED call failure, as core's ApiError or a plain object", () => {
    const failed = stubFailure(new BridgeCallFailed({ error: info }));
    expect(failed).toBeInstanceOf(JsnbError);
    expect((failed as JsnbError).name).toBe("CardDeclined");
    const plain = stubFailure({ code: 2001, message: "m", data: { error: info } });
    expect((plain as JsnbError).message).toBe("Your card was declined.");
  });

  it("passes every other failure through as it came", () => {
    const other = new ApiError(1003, { name: "KernelDead", message: "dead" });
    expect(stubFailure(other)).toBe(other);
    const malformed = { code: 2001, data: { error: { name: "x" } } };
    expect(stubFailure(malformed)).toBe(malformed);
    expect(stubFailure("text")).toBe("text");
  });
});
