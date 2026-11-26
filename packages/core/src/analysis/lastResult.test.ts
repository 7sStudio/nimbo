// An open notebook's last result: the run that ended last with an output worth showing, its value before
// what it printed, what a page drew, a display output, and nothing for events, errors or runs that did not end ok.
import { describe, expect, it } from "vitest";

import type { Execution } from "../model/execution.js";
import type { Output } from "../model/output.js";
import { lastResult } from "./lastResult.js";

const run = (
  endedAt: string | undefined,
  outputs: readonly Output[],
  status: Execution["status"] = "ok",
): Execution => ({
  id: "x_00000001",
  cell: "c_aaaaaa",
  status,
  startedAt: "2026-11-15T10:00:00.000Z",
  ...(endedAt === undefined ? {} : { endedAt }),
  outputs,
});
const value = (repr: string): Output => ({ kind: "value", json: null, repr, truncated: false });
const printed = (text: string): Output => ({ kind: "stream", stream: "stdout", text });

describe("lastResult", () => {
  it("takes the run that ended last with an output, its last value before what it printed", () => {
    const runs = [
      run("2026-11-15T10:00:02.000Z", [value("1")]),
      null,
      run("2026-11-15T10:00:05.000Z", [value("{\n  a: 1,\n  b: 2\n}"), printed("done\n")]),
      run("2026-11-15T10:00:09.000Z", [], "ok"),
      run("2026-11-15T10:00:09.000Z", [value("never")], "error"),
      run(undefined, [value("still running")], "running"),
    ];
    expect(lastResult(runs)).toEqual({
      cell: 3,
      at: "2026-11-15T10:00:05.000Z",
      kind: "value",
      lines: ["{", "  a: 1,", "  b: 2", "}"],
    });
  });

  it("says what a page drew, a display output, and else the last lines printed; none for events and errors", () => {
    const at = "2026-11-15T10:00:01.000Z";
    const lines = Array.from({ length: 9 }, (_, i) => `line ${String(i + 1)}`).join("\n");
    expect(
      lastResult([run(at, [{ kind: "dom", html: "<b>x</b>", text: " Paid\n 20.00 EUR " }])]),
    ).toEqual({ cell: 1, at, kind: "page", lines: ["Paid 20.00 EUR"] });
    expect(
      lastResult([run(at, [{ kind: "display", mime: "text/html", data: "<h3>Hi</h3>" }])]),
    ).toEqual({ cell: 1, at, kind: "html", lines: ["text/html, 11 characters"] });
    expect(lastResult([run(at, [printed(`${lines}\n`)])])?.lines).toEqual([
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
    ]);
    const event: Output = { kind: "event", name: "request", data: {}, at };
    expect(lastResult([run(at, [event, printed("  \n")])])).toBeNull();
    expect(lastResult([])).toBeNull();
  });
});
