// The record of registrations: order, aliases moving between tables, and the names that collide.
import { describe, expect, it } from "vitest";

import { createRegistrations, sameName } from "./registrations.ts";

const rows: readonly unknown[] = [];

describe("registrations", () => {
  it("keeps registrations in order, a re-registration moving to the end", () => {
    const record = createRegistrations();
    record.remember({ table: "a", source: rows, alias: undefined });
    record.remember({ table: "b", source: rows, alias: "events" });
    record.remember({ table: "a", source: rows, alias: undefined });
    expect(record.list().map((registration) => registration.table)).toEqual(["b", "a"]);
    expect(record.aliasOf("b")).toBe("events");
    record.forget("b");
    expect(record.aliasOf("b")).toBeUndefined();
    record.clear();
    expect(record.list()).toEqual([]);
  });

  it("plans the old alias view as stale when the alias changes or goes", () => {
    const record = createRegistrations();
    expect(record.plan("t", "events")).toEqual({ ok: true, value: [] });
    record.remember({ table: "t", source: rows, alias: "events" });
    expect(record.plan("t", "events")).toEqual({ ok: true, value: [] });
    expect(record.plan("t", undefined)).toEqual({ ok: true, value: ["events"] });
    expect(record.plan("t", "orders")).toEqual({ ok: true, value: ["events"] });
  });
});

describe("registrations and aliases", () => {
  it("moves an alias to the table registered with it last", () => {
    const record = createRegistrations();
    record.remember({ table: "t", source: rows, alias: "events" });
    record.remember({ table: "u", source: rows, alias: "events" });
    expect(record.aliasOf("t")).toBeUndefined();
    expect(record.aliasOf("u")).toBe("events");
  });

  it("refuses a table named like another table's alias, and an alias named like a table", () => {
    const record = createRegistrations();
    record.remember({ table: "t", source: rows, alias: "events" });
    expect(record.plan("events", undefined)).toMatchObject({
      ok: false,
      error: { data: { reason: "input" } },
    });
    expect(record.plan("u", "t")).toMatchObject({
      ok: false,
      error: { data: { reason: "input" } },
    });
  });
});

describe("registrations and case", () => {
  it("treats names that differ only in ASCII case as one, like DuckDB", () => {
    expect(sameName("Events", "events")).toBe(true);
    expect(sameName("É", "é")).toBe(false);
    const record = createRegistrations();
    record.remember({ table: "events", source: rows, alias: "E" });
    record.remember({ table: "Events", source: undefined, alias: undefined });
    expect(record.list()).toEqual([{ table: "Events", source: undefined, alias: undefined }]);
    record.forget("EVENTS");
    expect(record.list()).toEqual([]);
  });

  it("refuses clashes that differ only in case, and keeps an alias whose case changed", () => {
    const record = createRegistrations();
    record.remember({ table: "t", source: rows, alias: "events" });
    expect(record.plan("EVENTS", undefined)).toMatchObject({ ok: false });
    expect(record.plan("u", "T")).toMatchObject({ ok: false });
    expect(record.plan("T", "Events")).toEqual({ ok: true, value: [] });
    expect(record.aliasOf("T")).toBe("events");
  });
});
