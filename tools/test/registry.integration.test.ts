// Tests the registry stub's hold and release: a held package's request waits until release answers it, and a request
// after release is answered at once.
import { describe, expect, it } from "vitest";

import { startRegistry } from "./registry.js";
import { withWorkspace } from "./workspace.js";

const pkg = { name: "slow-pkg", version: "1.0.0", files: { "package.json": "{}" } };

describe("the registry stub", () => {
  it("answers held requests once released", async () => {
    await withWorkspace(async (ws) => {
      const registry = await startRegistry(ws, [pkg], { hold: ["slow-pkg"] });
      try {
        let settled = false;
        const asked = fetch(`${registry.url}/slow-pkg`).then((response) => {
          settled = true;
          return response;
        });
        await registry.held;
        expect(settled).toBe(false);
        registry.release();
        const answer = await asked;
        expect(answer.status).toBe(200);
        expect(await answer.json()).toMatchObject({ name: "slow-pkg" });
        expect((await fetch(`${registry.url}/slow-pkg`)).status).toBe(200);
      } finally {
        await registry.close();
      }
    });
  });
});
