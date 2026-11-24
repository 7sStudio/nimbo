// Tests the model against the corpus: each case's view, summary, rows, grid, hints and exports
// match its golden file in fixtures/corpus/.
import { beforeAll, describe, expect, it } from "vitest";

import { renderCase } from "./fixtures/render.js";
import { valueCases } from "./fixtures/values.js";
import { localIso } from "./time.js";

// ICU loads its time zone data on a process's first DateTimeFormat (about 12 ms): setup, not any one test's time.
beforeAll(() => {
  localIso(0, "Europe/Paris");
});

describe("corpus expectations", () => {
  it.each(valueCases)("renders $name as its golden file", async (c) => {
    await expect(renderCase(c)).toMatchFileSnapshot(`./fixtures/corpus/${c.name}.txt`);
  });
});
