// 08 §7 on the stylesheet the viewer ships (dist/style.css, after `pnpm build`), whose rules are mostly the views'
// Tailwind utilities, which Stylelint never sees in the CSS files it lints: the gate (@jsnb/style-gate) runs
// Stylelint itself on the compiled sheet. Its own tests show each rule biting on fixture CSS, and
// style.plants.contract.test.ts on the viewer's real classes.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { faults } from "./fixtures/viewerGate.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const style = join(root, "dist", "style.css");

/** The .vue and .ts files under `dir`, tests and fixtures left out. */
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "fixtures" ? [] : sources(path);
    return /\.(?:vue|ts)$/u.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });

describe("dist/style.css under 08 §7", () => {
  it("exists: the contract stage runs after the build", () => {
    expect(existsSync(style), "run `pnpm build` first").toBe(true);
  });

  it("keeps every rule inside the viewer and within 08 §7", async () => {
    expect(await faults(readFileSync(style, "utf8"))).toEqual([]);
  });

  it("gives position: fixed to the full-screen dialog and its scrim only", () => {
    const users = sources(join(root, "src")).filter((file) =>
      readFileSync(file, "utf8").includes("ov:fixed"),
    );
    expect(users.map((file) => file.slice(root.length))).toEqual(["src/vue/FullscreenDialog.vue"]);
  });

  it("holds only classes a view or a class file names, none a test or fixture leaked into the build", () => {
    const text = sources(join(root, "src"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const classes = new Set(
      [...readFileSync(style, "utf8").matchAll(/\.(ov\\:(?:\\.|[\w-])+)/gu)].map(([, name = ""]) =>
        name.replace(/\\(.)/gu, "$1"),
      ),
    );
    expect(classes.size).toBeGreaterThan(200);
    expect([...classes].filter((name) => !text.includes(name))).toEqual([]);
  });
});
