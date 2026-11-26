// Adjacent chunks of one stream read as one output; another stream, a value or a display between them keeps them apart.
import type { Output } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { mergeStreams } from "./streams.js";

const out = (text: string): Output => ({ kind: "stream", stream: "stdout", text });
const err = (text: string): Output => ({ kind: "stream", stream: "stderr", text });
const value: Output = { kind: "value", json: 1, repr: "1", truncated: false };
const indexed = (outputs: readonly Output[]) => outputs.map((output, index) => ({ output, index }));

describe("mergeStreams", () => {
  it("joins adjacent chunks of the same stream at the first chunk's index", () => {
    expect(mergeStreams(indexed([out("a\n"), out("b\n"), out("c\n")]))).toEqual([
      { index: 0, output: out("a\nb\nc\n") },
    ]);
  });

  it("keeps the order between stdout, stderr and values", () => {
    const outputs = [out("a\n"), out("b\n"), err("w\n"), err("x\n"), out("c\n"), value, out("d\n")];
    expect(mergeStreams(indexed(outputs))).toEqual([
      { index: 0, output: out("a\nb\n") },
      { index: 2, output: err("w\nx\n") },
      { index: 4, output: out("c\n") },
      { index: 5, output: value },
      { index: 6, output: out("d\n") },
    ]);
  });

  it("leaves a list with no adjacent chunks as it is", () => {
    expect(mergeStreams(indexed([out("a"), value]))).toEqual(indexed([out("a"), value]));
    expect(mergeStreams([])).toEqual([]);
  });
});
