// The cells' view models: the list item's label, why a cell is stale, whether its text changed since its last run, the
// routes a cell serves with their requests,
// a duration's text and a source's line count. The last run's fact for each status is runFact.test.ts's.
import type { Route } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import type { GraphEntry } from "../store/mirror.js";
import { cellLabel, editedSince, lineCount, routesOf, staleWhy } from "./models.js";
import { durationText } from "./runWords.js";

const entry = (patch: Partial<GraphEntry> = {}): GraphEntry => ({
  defines: [],
  uses: [],
  exports: [],
  dependsOn: [],
  ...patch,
});

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

describe("staleWhy", () => {
  it("names the first used name an upstream cell defines, with that cell's number", () => {
    const graph = new Map([
      ["a", entry({ defines: ["other"] })],
      ["b", entry({ defines: ["key", "stripe"] })],
    ]);
    const mine = entry({ uses: ["stripe"], dependsOn: ["a", "b"] });
    const numberOf = (id: string) => (id === "b" ? 2 : 1);
    expect(staleWhy(mine, graph, numberOf)).toBe("stripe changed in cell 2");
    // an upstream cell the graph does not hold is passed over
    expect(staleWhy(entry({ uses: ["other"], dependsOn: ["gone", "a"] }), graph, numberOf)).toBe(
      "other changed in cell 1",
    );
  });

  it("gives no reason when the graph names none", () => {
    const graph = new Map([["a", entry({ defines: ["other"] })]]);
    expect(staleWhy(undefined, graph, () => 1)).toBe("");
    expect(staleWhy(entry({ uses: ["x"] }), graph, () => 1)).toBe("");
    expect(staleWhy(entry({ uses: ["x"], dependsOn: ["a"] }), graph, () => 1)).toBe("");
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
