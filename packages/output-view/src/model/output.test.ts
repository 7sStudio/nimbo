// Tests output.ts: the viewer's input boundary, validated with core's Output schema.
import { describe, expect, it } from "vitest";

import { InvalidOutput, isInvalidOutput, toOutput } from "./output.js";

const outputs = [
  { kind: "stream", stream: "stdout", text: "hi" },
  { kind: "value", json: { a: 1 }, repr: "{ a: 1 }", truncated: true },
  { kind: "display", mime: "text/html", data: "<b>x</b>" },
  { kind: "dom", html: "<p>x</p>", text: "x" },
  {
    kind: "event",
    name: "POST /webhook",
    data: { status: 200 },
    at: "2026-10-10T14:02:11.000Z",
  },
  {
    kind: "error",
    error: { name: "TypeError", message: "x", frames: [], raw: "TypeError: x" },
  },
];

describe("toOutput", () => {
  it("passes every kind of Output through", () => {
    expect(outputs.map(toOutput)).toEqual(outputs);
  });

  it("reads the value shorthand as not truncated", () => {
    expect(toOutput({ kind: "value", json: 1, repr: "1" })).toEqual({
      kind: "value",
      json: 1,
      repr: "1",
      truncated: false,
    });
  });
});

describe("toOutput failures", () => {
  it("throws InvalidOutput naming the first issue", () => {
    const thrown = (() => {
      try {
        return toOutput({ kind: "value", json: 1 });
      } catch (error) {
        return error;
      }
    })();
    expect(thrown).toBeInstanceOf(InvalidOutput);
    expect((thrown as InvalidOutput).data.issues[0]?.path).toBe("repr");
    expect((thrown as InvalidOutput).message).toMatchSnapshot();
    expect(() => toOutput({ kind: "stream", text: 1 })).toThrow(InvalidOutput);
  });

  it("says so when the input is not an object at all", () => {
    expect(() => toOutput("nope")).toThrow(/not an output/);
  });
});

describe("InvalidOutput", () => {
  it("has a catalogue-style name and a message that says what to pass", () => {
    const error = new InvalidOutput({ issues: [] });
    expect(error.name).toBe("InvalidOutput");
    expect(error.message).toMatchSnapshot();
  });
});

describe("isInvalidOutput", () => {
  it("knows an InvalidOutput by its shape, also one from another copy of the class", () => {
    const thrown = (() => {
      try {
        return toOutput({ kind: "value" });
      } catch (error) {
        return error;
      }
    })();
    // what another bundle's InvalidOutput looks like: the same name, message and issues, another class
    const copy = Object.assign(new Error("not an output"), {
      name: "InvalidOutput",
      data: { issues: [{ path: "repr", message: "Required" }] },
    });
    expect([isInvalidOutput(thrown), isInvalidOutput(copy)]).toEqual([true, true]);
  });

  it("refuses another error, one without issues, and what is not an error", () => {
    const other = Object.assign(new Error("gone"), { name: "KernelDead", data: { issues: [] } });
    const bare = Object.assign(new Error("x"), { name: "InvalidOutput" });
    expect([other, bare, "InvalidOutput", null].map(isInvalidOutput)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
