// DuckDB's error text and JSON reports as QueryErrors: the message without the LINE block, the position in the SQL.
import { describe, expect, it } from "vitest";

import { cleanMessage, fromDuckDB, parsePosition, readReport } from "./diagnostics.ts";
import { copyPrefix, statements } from "./sql.ts";

const parser =
  'Parser Error: syntax error at or near "one"\n\nLINE 1: SELECT * FORM one\n                      ^';
const binderSql = "SELECT ok\n  , nope\nFROM t";
const binder =
  'Binder Error: Referenced column "nope" not found in FROM clause!\nCandidate bindings: "ok"\n\nLINE 2:   , nope\n            ^';

describe("parsePosition", () => {
  it("finds the caret on a single line", () => {
    expect(parsePosition(parser, "SELECT * FORM one")).toEqual({ ok: true, value: 14 });
  });

  it("counts the lines before the caret's line", () => {
    expect(parsePosition(binder, binderSql)).toEqual({
      ok: true,
      value: binderSql.indexOf("nope"),
    });
  });

  it("finds a shortened snippet in its line", () => {
    const line = `SELECT ${Array.from({ length: 30 }, (_, index) => `c${String(index)}`).join(", ")} FORM t`;
    const sql = `-- first line\n${line}`;
    const start = 60;
    const at = line.indexOf("FORM");
    const shown = line.slice(start, start + 40);
    const text = `Parser Error: syntax error\n\nLINE 2: ...${shown}...\n${" ".repeat(8 + 3 + at - start)}^`;
    expect(parsePosition(text, sql)).toEqual({ ok: true, value: sql.indexOf("FORM") });
  });

  it("says why when there is no position", () => {
    expect(parsePosition("Catalog Error: nope", "SELECT 1")).toEqual({
      ok: false,
      error: "no LINE block",
    });
    expect(parsePosition(parser, "")).toMatchObject({ ok: true });
    expect(parsePosition("x\nLINE 3: a\n         ^", "one line").ok).toBe(false);
    expect(parsePosition("x\nLINE 1: ...zzz\n           ^", "abc").ok).toBe(false);
  });
});

describe("cleanMessage", () => {
  it("drops every LINE block and node-api's prefix", () => {
    expect(cleanMessage(parser)).toBe('Parser Error: syntax error at or near "one"');
    expect(cleanMessage(binder)).toBe(
      'Binder Error: Referenced column "nope" not found in FROM clause!\nCandidate bindings: "ok"',
    );
    expect(cleanMessage(`Failed to extract statements: ${parser}`)).toBe(
      'Parser Error: syntax error at or near "one"',
    );
  });
});

describe("readReport", () => {
  it("reads DuckDB-WASM's JSON report", () => {
    const json = JSON.stringify({
      exception_type: "Parser",
      exception_message: `syntax error at or near "t"\n\nLINE 1: SELECT * FORM t\n                      ^`,
      position: "14",
    });
    expect(readReport(json)).toEqual({
      text: `Parser Error: syntax error at or near "t"\n\nLINE 1: SELECT * FORM t\n                      ^`,
      position: 14,
    });
  });

  it("keeps plain text and malformed or foreign JSON as they are", () => {
    expect(readReport("query was canceled")).toEqual({
      text: "query was canceled",
      position: undefined,
    });
    expect(readReport("{oops")).toEqual({ text: "{oops", position: undefined });
    expect(readReport('{"a":1}')).toEqual({ text: '{"a":1}', position: undefined });
    expect(readReport('{"exception_type":"IO","exception_message":"x"}')).toEqual({
      text: "IO Error: x",
      position: undefined,
    });
  });
});

describe("fromDuckDB", () => {
  it("makes a query error with the message and position", () => {
    const error = fromDuckDB(new Error(parser), "SELECT * FORM one");
    expect(error.data.reason).toBe("query");
    expect(error.message).toBe('Parser Error: syntax error at or near "one"');
    expect(error.position).toBe(14);
  });

  it("shifts the position back by the COPY prefix and drops one outside the user's SQL", () => {
    const sql = "SELECT * FORM one";
    const sent = statements.copy(sql, "out.csv", "csv");
    const text = JSON.stringify({
      exception_type: "Parser",
      exception_message: "x",
      position: String(copyPrefix.length + 14),
    });
    expect(fromDuckDB(new Error(text), sent, copyPrefix.length).position).toBe(14);
    const before = JSON.stringify({
      exception_type: "Parser",
      exception_message: "x",
      position: "2",
    });
    expect(fromDuckDB(new Error(before), sent, copyPrefix.length).position).toBeUndefined();
    expect(fromDuckDB("plain", "SELECT 1").position).toBeUndefined();
  });
});
