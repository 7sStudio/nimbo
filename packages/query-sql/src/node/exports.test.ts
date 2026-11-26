// The package's exports, as every workspace package's: each entry resolves to its source under the
// `development` condition (before `types` and `import`), and the published map, dist only, has no such condition.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const manifest: unknown = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

describe("package exports", () => {
  it("resolve to the sources first under the development condition", () => {
    expect(field(manifest, "exports")).toEqual({
      ".": { development: "./src/index.ts", types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./node": {
        development: "./src/node/index.ts",
        types: "./dist/node/index.d.ts",
        import: "./dist/node/index.js",
      },
    });
    for (const key of [".", "./node"]) {
      const entry = field(field(manifest, "exports"), key);
      expect(typeof entry === "object" && entry !== null ? Object.keys(entry)[0] : undefined).toBe(
        "development",
      );
    }
  });

  it("publish the dist-only map, without the development condition", () => {
    expect(field(field(manifest, "publishConfig"), "exports")).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./node": { types: "./dist/node/index.d.ts", import: "./dist/node/index.js" },
    });
  });
});
