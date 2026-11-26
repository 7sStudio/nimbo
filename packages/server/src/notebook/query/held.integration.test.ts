// A retained value in the JSON engines: cell.outputQuery holds it in their worker under its
// key, so a second query does not send it again; the key goes from the engines when the value is dropped (the cell ran
// again) and when its notebook closes; past outputs.retainMaxBytes the engines let the oldest go, and a later query of
// it holds it again. Over the daemon's own workspace services, the built kernel and the real engines.
import type { CellId, QueryMode } from "@jsnb/core";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { openTestWorkspace } from "../../fixtures/workspace.js";
import type { Session } from "../session/session.js";
import type { Workspace } from "../workspace/workspace.js";
import { heldKey } from "./engines.js";

/** `count` items, some 41 bytes of JSON each: past 256 KiB (outputs.maxValueBytes) the output is cut and retained. */
const items = (count: number) =>
  `Array.from({ length: ${String(count)} }, (_, i) => ({ i, text: 'x'.repeat(20) }))`;
const big = items(20_000);
const editor = { client: "cli" } as const;
const waiting = { wait: true, timeoutMs: 60_000 };

async function ran(session: Session, cell: CellId): Promise<string> {
  const execution = await session.run(cell, waiting);
  expect(execution.status).toBe("ok");
  return execution.id;
}

const ask = (session: Session, cell: CellId, mode: QueryMode, query: string) =>
  session.outputQuery({ cell, index: 0, mode, query, limit: 5 });

/** What the jq engine holds under `key`: its length, or the failure when it holds nothing there. */
async function heldLength(workspace: Workspace, key: string) {
  const compiled = (await workspace.engines.jq()).compile("length");
  if (!compiled.ok) throw new Error(compiled.error.message);
  return compiled.value.transformHeld(key);
}

const nothingHeld = (key: string) => ({
  ok: false,
  error: {
    kind: "unavailable",
    message: `Nothing is held under ${key}. Hold the value (hold), then run the query.`,
  },
});

describe("a retained value queried in jq", () => {
  it("is held under its key, and goes from the engines when its cell runs again and when the notebook closes", async () => {
    await withWorkspace(async (ws) => {
      const workspace = await openTestWorkspace(ws);
      try {
        const session = await workspace.notebooks.create("a.jsnb");
        const cell = session.add({ type: "server", source: big }, editor).id;
        const first = await ran(session, cell);
        expect((await ask(session, cell, "jq", "length")).result.value).toBe(20_000);
        const key = heldKey("a.jsnb", first, 0);
        expect(await heldLength(workspace, key)).toEqual({
          ok: true,
          value: { value: 20_000, count: 1 },
        });
        const second = await ran(session, cell);
        expect(await heldLength(workspace, key)).toEqual(nothingHeld(key));
        expect((await ask(session, cell, "jq", ".[1].i")).result.value).toBe(1);
        await workspace.notebooks.close("a.jsnb");
        const closed = heldKey("a.jsnb", second, 0);
        expect(await heldLength(workspace, closed)).toEqual(nothingHeld(closed));
      } finally {
        await workspace.close();
      }
    });
  });
});

describe("retained values past outputs.retainMaxBytes in the engines", () => {
  it("let the oldest go from the engines, and a later query holds it again", async () => {
    await withWorkspace(async (ws) => {
      const workspace = await openTestWorkspace(ws);
      try {
        // each notebook retains its 409 KB value, which the engines cannot hold both of
        await workspace.settings.set("outputs.retainMaxBytes", 600_000, "workspace");
        const [a, b] = await Promise.all(
          ["a.jsnb", "b.jsnb"].map((ref) => workspace.notebooks.create(ref)),
        );
        if (!a || !b) throw new Error("two notebooks");
        const cellA = a.add({ type: "server", source: items(10_000) }, editor).id;
        const cellB = b.add({ type: "server", source: items(10_000) }, editor).id;
        const keyA = heldKey("a.jsnb", await ran(a, cellA), 0);
        const keyB = heldKey("b.jsnb", await ran(b, cellB), 0);
        await ask(a, cellA, "jq", "length");
        await ask(b, cellB, "jq", "length");
        expect(await heldLength(workspace, keyA)).toEqual(nothingHeld(keyA));
        expect((await ask(a, cellA, "jq", "length")).result.value).toBe(10_000);
        expect(await heldLength(workspace, keyA)).toMatchObject({ ok: true });
        expect(await heldLength(workspace, keyB)).toEqual(nothingHeld(keyB));
      } finally {
        await workspace.close();
      }
    });
  });
});
