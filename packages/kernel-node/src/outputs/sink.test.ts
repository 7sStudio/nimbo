// Tests the sink of 04-kernel §5.1: coalescing, flush order, redaction of whole segments, a printed stack's cell
// positions rewritten (a real compiled cell's), a write stopped before its flush is marked (a stub: a schedule that
// throws once stands for a termination inside the write, which would end the test's own code), the stream cap,
// retirement.
import type { ExecutionId, Output } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { realCell } from "../fixtures/compiledCell.js";
import { rewritePositions } from "./frames.js";
import { createRedactor } from "./redact.js";
import type { SinkOptions } from "./sink.js";
import { createSink } from "./sink.js";

const first = { cell: "c_aaaaaa", execution: "x_aaaaaaaa" };
/** A real cell whose line 2 throws, compiled by the kernel's compiler: the stack positions the sink rewrites. */
const printed = realCell("const a = 1\nthrow new Error('two')", {
  notebook: "My Notes/a (1).jsnb",
});
const rewrite = (text: string): string => rewritePositions(text, printed.context);
const second = { cell: "c_aaaaaa", execution: "x_bbbbbbbb" };

/** A sink with a manual scheduler: `tick()` runs what the 16 ms timer would. */
function harness(options: Partial<SinkOptions> = {}) {
  const sent: { execution: ExecutionId; output: Output }[] = [];
  const due: (() => void)[] = [];
  const sink = createSink({
    send: (execution, output) => sent.push({ execution, output }),
    redact: createRedactor(["supersecretvalue"]),
    rewrite,
    maxStreamBytes: 1_048_576,
    schedule: (flush) => due.push(flush),
    ...options,
  });
  const tick = () => {
    for (const flush of due.splice(0)) flush();
  };
  return { sink, sent, due, tick, texts: () => sent.map(({ output }) => output) };
}

describe("createSink coalescing", () => {
  it("merges chunks of one stream, splits at a stream switch and flushes on the scheduler", () => {
    const { sink, texts, tick, due } = harness();
    sink.write(first, "stdout", "a");
    sink.write(first, "stdout", "b");
    sink.write(first, "stderr", "c");
    sink.write(first, "stdout", "d");
    expect(due).toHaveLength(1);
    expect(texts()).toEqual([]);
    tick();
    expect(texts()).toEqual([
      { kind: "stream", stream: "stdout", text: "ab" },
      { kind: "stream", stream: "stderr", text: "c" },
      { kind: "stream", stream: "stdout", text: "d" },
    ]);
  });

  it("flushes pending text before any other output of the execution, and a stale timer does nothing", () => {
    const { sink, texts, tick } = harness();
    sink.write(first, "stdout", "log");
    sink.emit(first, { kind: "display", mime: "text/html", data: "<b>" });
    tick();
    expect(texts()).toEqual([
      { kind: "stream", stream: "stdout", text: "log" },
      { kind: "display", mime: "text/html", data: "<b>" },
    ]);
  });

  it("redacts a whole segment, so a secret split across chunks is masked", () => {
    const { sink, texts } = harness();
    sink.write(first, "stdout", "key supersecr");
    sink.write(first, "stdout", "etvalue end");
    sink.flush(first.execution);
    expect(texts()).toEqual([{ kind: "stream", stream: "stdout", text: "key *** end" }]);
  });
});

describe("createSink printed stacks", () => {
  it("rewrites the cell positions of a printed stack to the cell's own lines, after redaction", async () => {
    const thrown = await printed.run();
    const stack = thrown instanceof Error ? (thrown.stack ?? "") : "";
    const { sink, texts } = harness();
    sink.write(first, "stderr", `${stack} supersecretvalue`);
    sink.flush(first.execution);
    const [output] = texts();
    const text = output?.kind === "stream" ? output.text : "";
    expect(text).toContain(`${printed.url}:2:`);
    expect(text).toMatch(/\*\*\*$/);
  });
});

describe("createSink stopped in a write", () => {
  it("never leaves the execution marked pending without a flush timer, so later text still flushes", () => {
    const due: (() => void)[] = [];
    const sent: Output[] = [];
    let refuse = true;
    const sink = createSink({
      send: (_execution, output) => sent.push(output),
      redact: createRedactor([]),
      rewrite,
      maxStreamBytes: 1_048_576,
      schedule: (flush) => {
        if (refuse) {
          refuse = false;
          throw new Error("stopped between two statements");
        }
        due.push(flush);
      },
    });
    expect(() => {
      sink.write(first, "stdout", "a");
    }).toThrow("stopped between two statements");
    sink.write(first, "stdout", "b");
    for (const flush of due.splice(0)) flush();
    expect(sent).toEqual([{ kind: "stream", stream: "stdout", text: "ab" }]);
  });
});

describe("createSink cap", () => {
  it("cuts the crossing chunk to fit, adds one notice and drops later text", () => {
    const { sink, texts, tick } = harness({ maxStreamBytes: 10 });
    sink.write(first, "stdout", "12345");
    tick();
    sink.write(first, "stderr", "éèabc");
    sink.write(first, "stdout", "more");
    tick();
    sink.write(first, "stdout", "never");
    sink.flush(first.execution);
    expect(texts()).toEqual([
      { kind: "stream", stream: "stdout", text: "12345" },
      { kind: "stream", stream: "stderr", text: "éèa" },
      { kind: "stream", stream: "stderr", text: "[output truncated]" },
    ]);
  });

  it("counts UTF-8 bytes and never splits a code point", () => {
    const { sink, texts } = harness({ maxStreamBytes: 5 });
    sink.write(first, "stdout", "a😀b");
    sink.flush(first.execution);
    expect(texts()[0]).toEqual({ kind: "stream", stream: "stdout", text: "a😀" });
  });
});

describe("createSink executions", () => {
  it("retires a cell's previous execution when the cell runs again", () => {
    const { sink, sent } = harness();
    sink.begin(first);
    sink.write(first, "stdout", "old");
    sink.begin(second);
    expect(sent).toEqual([
      { execution: first.execution, output: { kind: "stream", stream: "stdout", text: "old" } },
    ]);
  });

  it("sends late text of a retired execution under its own id and keeps no state for it", () => {
    const { sink, sent, tick } = harness({ maxStreamBytes: 4 });
    sink.begin(first);
    sink.begin(second);
    sink.write(first, "stdout", "late");
    tick();
    sink.write(first, "stdout", "again");
    sink.flushAll();
    expect(
      sent.map(({ execution, output }) => [execution, output.kind === "stream" && output.text]),
    ).toEqual([
      [first.execution, "late"],
      [first.execution, "agai"],
      [first.execution, "[output truncated]"],
    ]);
  });
});
