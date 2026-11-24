// Tests the console built-in: the log methods map to stdout and stderr, format the way util.format does, and a write
// stopped half-way (as an interrupt stops user code inside console.log) does not hold back later writes.
import { describe, expect, it } from "vitest";

import { createConsole } from "./streams.js";

const capture = () => {
  const written: [string, string][] = [];
  const console = createConsole((stream, text) => written.push([stream, text]));
  return { console, written };
};

describe("createConsole", () => {
  it("writes log, info and debug to stdout and warn and error to stderr", () => {
    const { console, written } = capture();
    console.log("a");
    console.info("b");
    console.debug("c");
    console.warn("d");
    console.error("e");
    expect(written).toEqual([
      ["stdout", "a\n"],
      ["stdout", "b\n"],
      ["stdout", "c\n"],
      ["stderr", "d\n"],
      ["stderr", "e\n"],
    ]);
  });

  it("formats placeholders and inspects objects two levels deep without colours", () => {
    const { console, written } = capture();
    console.log("%s=%d", "n", 4, { a: { b: { c: { d: 1 } } } });
    expect(written).toEqual([["stdout", "n=4 { a: { b: { c: [Object] } } }\n"]]);
  });
});

describe("createConsole stopped in a write", () => {
  it("keeps writing every later chunk", () => {
    const written: string[] = [];
    let stop = true;
    const console = createConsole((_stream, text) => {
      if (stop) {
        stop = false;
        throw new Error("stopped in the middle of a write");
      }
      written.push(text);
    });
    expect(() => {
      console.log("first");
    }).toThrow("stopped in the middle of a write");
    console.log("second");
    console.error("third");
    expect(written).toEqual(["second\n", "third\n"]);
  });
});
