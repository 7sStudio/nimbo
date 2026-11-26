// Case 11 corpus through the real kernel: default, named, namespace and side-effect imports from
// an ESM, a CJS and a side-effect package in the workspace's node_modules, a relative .ts file edited between runs,
// `require` and `node:` imports; the pre-flight over the same workspace.
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { KernelEvent } from "@jsnb/core";
import { decode } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";
import { missingPackages } from "./preflight.js";

const packages: Readonly<Record<string, string>> = {
  "node_modules/esm-pkg/package.json":
    '{ "name": "esm-pkg", "type": "module", "exports": "./index.js" }',
  "node_modules/esm-pkg/index.js":
    'export default function greet(name) { return "hi " + name }\nexport const named = 42\n',
  "node_modules/cjs-pkg/package.json": '{ "name": "cjs-pkg", "main": "index.js" }',
  "node_modules/cjs-pkg/index.js": 'exports.add = (a, b) => a + b\nexports.version = "1.0.0"\n',
  "node_modules/side-pkg/package.json":
    '{ "name": "side-pkg", "type": "module", "exports": "./index.js" }',
  "node_modules/side-pkg/index.js": "globalThis.sideEffects = (globalThis.sideEffects ?? 0) + 1\n",
  "lib/prices.ts": "export const price: number = 10\n",
};

const book = cellBook({
  esm: 'import greet, { named } from "esm-pkg"\n[greet("x"), named]',
  namespace: 'import * as esm from "esm-pkg"\n[typeof esm.default, esm.named]',
  cjs: 'import cjs, { add } from "cjs-pkg"\n[cjs.add(1, 2), add(2, 3)]',
  side: 'import "side-pkg"\nglobalThis.sideEffects',
  relative: 'import { price } from "./lib/prices.ts"\nprice',
  required:
    'const { createHash } = require("node:crypto")\ncreateHash("sha256").update("a").digest("hex").length',
  builtin: 'import { join } from "node:path"\njoin("a", "b")',
  requiredPackage: 'require("cjs-pkg").version',
});

beforeAll(() => {
  book.compile(compileCell);
});

async function writeAll(ws: Workspace, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(ws.path(path)), { recursive: true });
    await writeFile(ws.path(path), text);
  }
}

/** The decoded value of a run that ended ok. */
function valueOf(events: readonly KernelEvent[]): unknown {
  expect(events.at(-1)).toMatchObject({ status: "ok" });
  const found = events.find((event) => event.kind === "output" && event.output.kind === "value");
  return found?.kind === "output" && found.output.kind === "value"
    ? decode(found.output.json)
    : undefined;
}

describe("case 11: imports through the real kernel", () => {
  it("imports ESM, CJS and side-effect packages, a relative .ts file, require and node: modules", async () => {
    await withKernel(
      async ({ run, ws }) => {
        await writeAll(ws, packages);
        expect(valueOf(await run(book.cell("esm")))).toEqual(["hi x", 42]);
        expect(valueOf(await run(book.cell("namespace")))).toEqual(["function", 42]);
        expect(valueOf(await run(book.cell("cjs")))).toEqual([3, 5]);
        expect(valueOf(await run(book.cell("side")))).toBe(1);
        expect(valueOf(await run(book.cell("side")))).toBe(1);
        expect(valueOf(await run(book.cell("relative")))).toBe(10);
        await writeFile(ws.path("lib/prices.ts"), "export const price: number = 12\n");
        const later = new Date(Date.now() + 60_000);
        await utimes(ws.path("lib/prices.ts"), later, later);
        expect(valueOf(await run(book.cell("relative")))).toBe(12);
        expect(valueOf(await run(book.cell("required")))).toBe(64);
        expect(valueOf(await run(book.cell("builtin")))).toBe("a/b");
        expect(valueOf(await run(book.cell("requiredPackage")))).toBe("1.0.0");
      },
      { packageJson: { name: "ws", type: "module" } },
    );
  });

  it("finds in the pre-flight only the package the workspace does not have", async () => {
    await withWorkspace(async (ws) => {
      await writeAll(ws, packages);
      const local = ["node:fs", "./lib/prices.ts"];
      const imports = ["esm-pkg", "cjs-pkg/sub", "side-pkg", "absent-pkg", ...local];
      expect(missingPackages(ws.dir, imports)).toEqual(["absent-pkg"]);
    });
  });
});
