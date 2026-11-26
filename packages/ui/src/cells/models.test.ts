// The cells' view models: the list item's label, whether its text changed since its last run, the routes a cell
// serves with their requests,
// a duration's text and a source's line count. The last run's fact for each status is runFact.test.ts's.
import type { Route } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { cellLabel, editedSince, lineCount, routesOf } from "./models.js";
import { durationText } from "./runWords.js";

describe("cellLabel", () => {
  it("says the number, the type and the state, stale only while nothing runs or failed", () => {
    expect(cellLabel({ number: 3, type: "server", status: "ok", stale: false })).toBe(
      "Cell 3, server, ok",
    );
    expect(cellLabel({ number: 3, type: "client", status: "ok", stale: true })).toBe(
      "Cell 3, client, stale",
    );
    expect(cellLabel({ number: 1, type: "server", status: "error", stale: true })).toBe(
      "Cell 1, server, error",
    );
    expect(cellLabel({ number: 1, type: "server", status: "queued", stale: true })).toBe(
      "Cell 1, server, queued",
    );
  });
});

describe("editedSince", () => {
  const run = (startedAt: string) => ({
    id: "x1",
    status: "ok" as const,
    startedAt,
    hasError: false,
    defines: [],
  });
  const edit = (at: string) => ({ lastEdit: { by: "user" as const, client: "ui" as const, at } });

  it("says the text changed when the last edit is later than the last run's start", () => {
    const lastExecution = run("2026-11-02T10:00:00.000Z");
    expect(editedSince({ meta: edit("2026-11-02T10:00:01.000Z"), lastExecution })).toBe(true);
    expect(editedSince({ meta: edit("2026-11-02T09:59:59.000Z"), lastExecution })).toBe(false);
    expect(editedSince({ meta: edit("2026-11-02T10:00:00.000Z"), lastExecution })).toBe(false);
  });

  it("says nothing of a cell with no edit, no run, or a time it cannot read", () => {
    const lastExecution = run("2026-11-02T10:00:00.000Z");
    expect(editedSince({ meta: {}, lastExecution })).toBe(false);
    expect(editedSince({ meta: edit("2026-11-02T10:00:01.000Z"), lastExecution: null })).toBe(
      false,
    );
    expect(editedSince({ meta: edit("not a time"), lastExecution })).toBe(false);
    expect(editedSince({ meta: edit("2026-11-02T10:00:01.000Z"), lastExecution: run("") })).toBe(
      false,
    );
  });
});

describe("routesOf", () => {
  it("counts the cell's own routes and adds up the requests they answered", () => {
    const route = (cell: string, path: string, hits: number): Route => ({
      spec: `GET ${path}`,
      method: "GET",
      path,
      url: "",
      cell,
      registeredAt: "",
      hits,
    });
    const routes = [route("c1", "/a", 2), route("other", "/b", 7), route("c1", "/c", 3)];
    expect(routesOf("c1", routes)).toEqual({ count: 2, hits: 5 });
    expect(routesOf("none", routes)).toEqual({ count: 0, hits: 0 });
    expect(routesOf("c1", [])).toEqual({ count: 0, hits: 0 });
  });
});

describe("durationText and lineCount", () => {
  it("writes milliseconds under a second, tenths of seconds above, and counts lines", () => {
    expect(durationText(412.4)).toBe("412 ms");
    expect([durationText(0.02), durationText(0.44), durationText(9.96)]).toEqual([
      "under 0.1 ms",
      "0.4 ms",
      "10 ms",
    ]);
    expect(durationText(999.4)).toBe("999 ms");
    expect(durationText(1000)).toBe("1.0 s");
    expect(durationText(2400)).toBe("2.4 s");
    expect(lineCount("a\nb\nc")).toBe(3);
    expect(lineCount("")).toBe(1);
  });
});
