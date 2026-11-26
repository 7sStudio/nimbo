// Tests that a cut value reads its full value exactly as the same value uncut reads itself: the daemon streams the wire
// form, so the JSON export, the other exports and SQL's table are the same either way, for
// a value with dates, Sets, a `$`-key and a repeated reference. Each export is checked cut and uncut against one
// expected result; SQL's table, on the real engine, in tests/output-view (fullvalue.integration.test.ts).
import { encode, truncatedMarker } from "@jsnb/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { settle, until } from "./fixtures/mount.js";
import { mountOutput, warmUp } from "./fixtures/outputs.js";

// The first mount of the viewer warms its modules up: setup, not any one test's time.
beforeAll(warmUp);
afterEach(() => {
  vi.restoreAllMocks();
});

const owner = { id: "o_1" };
const { json: full } = encode([
  { created: new Date("2026-10-12T10:00:00.000Z"), tags: new Set(["a"]), $meta: 1, owner },
  { created: new Date("2026-10-12T11:00:00.000Z"), tags: new Set(["b"]), $meta: 2, owner },
]);
const first: unknown = Array.isArray(full) ? full[0] : undefined;
const uncut = { output: { kind: "value", json: full, repr: "", truncated: false } };
/** The same value cut to its first record, its full value streamed in the wire form. */
const cut = {
  output: { kind: "value", json: [first, truncatedMarker], repr: "", truncated: true },
  fullValueUrl: "/outputs/e1/0.json",
  onFetchFullValue: () => Promise.resolve(new Blob([JSON.stringify(full)])),
};

/** The plain rows both export: dates as ISO text, Sets as arrays, the key as written, the reference resolved. */
const rows = [
  { created: "2026-10-12T10:00:00.000Z", tags: ["a"], $meta: 1, owner: { id: "o_1" } },
  { created: "2026-10-12T11:00:00.000Z", tags: ["b"], $meta: 2, owner: { id: "o_1" } },
];
const expected = {
  JSON: `${JSON.stringify(rows, null, 2)}\n`,
  NDJSON: rows.map((row) => `${JSON.stringify(row)}\n`).join(""),
};

/** Exports JSON, then NDJSON, from a viewer mounted with `props`, and answers the saved texts. */
async function exports(props: Record<string, unknown>): Promise<Record<string, string>> {
  const saved: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    if (blob instanceof Blob) saved.push(blob);
    return "blob:export";
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const { wrapper } = mountOutput(props);
  for (const [index, format] of ["JSON", "NDJSON"].entries()) {
    await wrapper.get('[aria-label="Export"]').trigger("keydown", { key: "Enter" });
    await settle();
    [...document.querySelectorAll<HTMLElement>('[data-part="menu-item"]')]
      .find((element) => element.textContent.trim() === format)
      ?.click();
    await until(() => {
      expect(saved).toHaveLength(index + 1);
    });
  }
  return { JSON: (await saved[0]?.text()) ?? "", NDJSON: (await saved[1]?.text()) ?? "" };
}

describe("exports, cut or not", () => {
  it("exports the value uncut as plain JSON and NDJSON", async () => {
    expect(await exports(uncut)).toEqual(expected);
  });

  it("exports a cut value's full value as the same JSON and NDJSON", async () => {
    expect(await exports(cut)).toEqual(expected);
  });
});
