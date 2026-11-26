// QueryError's shape and the message template of every reason (snapshots: a message changes only on purpose).
import { describe, expect, it } from "vitest";

import { QueryError, asQueryError, loadError, messages, stopError } from "./errors.ts";

describe("QueryError", () => {
  it("carries its reason, position and cause", () => {
    const cause = new Error("inner");
    const error = new QueryError("query", "Parser Error: x", { position: 3, cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("QueryError");
    expect(error.data).toEqual({ reason: "query" });
    expect(error.position).toBe(3);
    expect(error.cause).toBe(cause);
  });

  it("has no position and no cause when none are given", () => {
    const error = new QueryError("closed", messages.closed());
    expect(error.position).toBeUndefined();
    expect("cause" in error).toBe(false);
  });
});

describe("messages", () => {
  it("name the thing and say what to do", () => {
    expect(messages.cancelled()).toMatchInlineSnapshot(
      `"The SQL query was cancelled before it finished. Run it again to see its result."`,
    );
    expect(messages.timeout(5000)).toMatchInlineSnapshot(
      `"The SQL query ran longer than 5000 ms and was stopped. Narrow it with WHERE or LIMIT, or raise query.timeoutMs."`,
    );
    expect(messages.load("Failed to fetch")).toMatchInlineSnapshot(
      `"The SQL engine could not be loaded (Failed to fetch). Check the connection and try again; the next call retries the load."`,
    );
    expect(messages.network()).toMatchInlineSnapshot(
      `"The SQL engine needs the network the first time, to fetch DuckDB's JSON reader, and could not reach it. Run the query again once the network is back."`,
    );
    expect(messages.crashed()).toMatchInlineSnapshot(
      `"The SQL engine stopped unexpectedly. It restarts on the next query and restores the registered tables."`,
    );
    expect(messages.closed()).toMatchInlineSnapshot(
      `"The SQL engine was closed while this call was running. Run it again to start a new engine."`,
    );
  });
});

describe("input messages", () => {
  it("describe each bad input with the value given", () => {
    expect(messages.name("alias", "")).toMatchInlineSnapshot(
      `"The alias name "" is not valid. Use 1 to 128 characters, no NUL character and no __nimbo_ prefix."`,
    );
    expect(messages.taken("events", "t")).toMatchInlineSnapshot(
      `"The name "events" is already used by the table "t". Pick another name, or drop "t" first."`,
    );
    expect(messages.limit(-1)).toMatchInlineSnapshot(
      `"The row limit -1 is not valid. Use a whole number of rows, 0 or more."`,
    );
    expect(messages.rows("t", "Do not know how to serialize a BigInt")).toMatchInlineSnapshot(
      `"The rows for table "t" cannot be encoded as JSON (Do not know how to serialize a BigInt). Convert BigInt values to numbers or strings and remove circular references."`,
    );
    expect(messages.source("t")).toMatchInlineSnapshot(
      `"The source for table "t" is not an array of rows, an Arrow table or a Blob. Pass one of those three."`,
    );
    expect(messages.format("xml")).toMatchInlineSnapshot(
      `"The export format "xml" is not valid. Use "csv" or "ndjson"."`,
    );
    expect(messages.option("timeoutMs", 0)).toMatchInlineSnapshot(
      `"The engine option timeoutMs = 0 is not valid. Use a positive number of milliseconds for timeoutMs and a whole number of rows for maxRows."`,
    );
  });

  it("names the ::VARCHAR way round for ENUM in the page", () => {
    expect(messages.enumeration()).toMatchInlineSnapshot(
      `"The page's SQL engine cannot read ENUM values: DuckDB-WASM streams them without their labels. Cast the column to text in the query, for example status::VARCHAR."`,
    );
  });

  it("asks the daemon for the folder its engine may write to", () => {
    expect(messages.directory("")).toMatchInlineSnapshot(
      `"The SQL engine's directory "" is not valid. Pass the folder it may write its files to, such as .jsnb/cache/sql."`,
    );
  });
});

describe("stopError", () => {
  it("is timeout with the deadline for a timeout, cancelled otherwise", () => {
    expect(stopError("timeout", 250).data.reason).toBe("timeout");
    expect(stopError("timeout", 250).message).toContain("250 ms");
    expect(stopError("cancelled", 250).data.reason).toBe("cancelled");
  });
});

describe("loadError", () => {
  it("names the cause's message and keeps the cause", () => {
    const cause = new TypeError("Failed to fetch dynamically imported module");
    const error = loadError(cause);
    expect(error.data.reason).toBe("load");
    expect(error.message).toContain("Failed to fetch dynamically imported module");
    expect(error.cause).toBe(cause);
    expect(loadError("no worker").message).toContain("(no worker)");
  });
});

describe("asQueryError", () => {
  it("keeps a QueryError and turns anything else into reason query", () => {
    const own = new QueryError("timeout", "late");
    expect(asQueryError(own)).toBe(own);
    const converted = asQueryError(new Error("boom"));
    expect(converted.data.reason).toBe("query");
    expect(converted.message).toBe("boom");
    expect(asQueryError("text").message).toBe("text");
  });
});
