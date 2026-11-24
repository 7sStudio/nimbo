// DuckDB clears a connection's interrupt when it begins a statement, so an interrupt that lands between the stream
// call and that start is lost and the statement runs to its end (measured: 10 of 10 interrupts sent right after
// connection.stream were lost). A cancel, a timeout or a close that comes that early must still stop the statement:
// the root cause of the "cancel on Node" flake under load.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DuckDBConnection } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { deadline } from "../abort.ts";
import { QueryError } from "../errors.ts";
import { openInstance } from "./instance.ts";
import { collectChunks } from "./result.ts";
import { stream } from "./run.ts";

const endless = "SELECT count(*) AS n FROM range(1000000000000)";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nimbo-query-sql-"));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("a cancel that lands before DuckDB begins the statement", () => {
  it("still stops it", async () => {
    const node = await openInstance(directory);
    const connection = await node.connect();
    const controller = new AbortController();
    const stop = deadline(controller.signal, Number.POSITIVE_INFINITY);
    const running = stream(node, connection, { sql: endless, stop }, (chunks) =>
      collectChunks(chunks, 10, stop),
    );
    controller.abort(); // the stream call was made, DuckDB has not begun the statement yet
    await expect(running).rejects.toMatchObject({ data: { reason: "cancelled" } });
    stop.clear();
    node.release(connection);
    node.close(new QueryError("closed", "test over"));
  });
});

describe("a close that lands before DuckDB begins the statement", () => {
  it("still stops it, then frees the connection", async () => {
    const closes = vi.spyOn(DuckDBConnection.prototype, "closeSync");
    try {
      const node = await openInstance(directory);
      const connection = await node.connect();
      const stop = deadline(undefined, Number.POSITIVE_INFINITY);
      const running = stream(node, connection, { sql: endless, stop }, (chunks) =>
        collectChunks(chunks, 10, stop),
      );
      const before = closes.mock.calls.length;
      node.close(new QueryError("closed", "closed under the statement"));
      await expect(running).rejects.toMatchObject({ data: { reason: "closed" } });
      await expect.poll(() => closes.mock.calls.length, { timeout: 5000 }).toBeGreaterThan(before);
      stop.clear();
    } finally {
      closes.mockRestore();
    }
  });
});
