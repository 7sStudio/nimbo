// The DuckDB-WASM build the page ships: the eh build's module and worker are served and Chromium runs it.
import { describe, expect, it } from "vitest";

import { bundle } from "./bundles.ts";

describe("bundles", () => {
  it("serves the eh build's module and worker", async () => {
    for (const url of [bundle.mainModule, bundle.mainWorker]) {
      const response = await fetch(url ?? "", { method: "HEAD" });
      expect(response.status).toBe(200);
    }
  });
});
