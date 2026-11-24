// The one-time move of the user config folder from its old name: the settings survive, a newer folder is never replaced.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { withLegacyConfigMoved } from "./legacyConfigDir.js";

let base = "";
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "nimbo-config-"));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

it("moves the old folder with its files when the new one does not exist", () => {
  mkdirSync(join(base, "jsnb"));
  writeFileSync(join(base, "jsnb", "settings.json"), '{ "editor.fontSize": 14 }');
  const dir = withLegacyConfigMoved(join(base, "nimbo"));
  expect(readFileSync(join(dir, "settings.json"), "utf8")).toContain("14");
  expect(() => readFileSync(join(base, "jsnb", "settings.json"))).toThrow();
});

it("leaves both folders when the new one already exists", () => {
  mkdirSync(join(base, "jsnb"));
  mkdirSync(join(base, "nimbo"));
  writeFileSync(join(base, "nimbo", "settings.json"), "{}");
  writeFileSync(join(base, "jsnb", "settings.json"), '{ "old": true }');
  withLegacyConfigMoved(join(base, "nimbo"));
  expect(readFileSync(join(base, "nimbo", "settings.json"), "utf8")).toBe("{}");
  expect(readFileSync(join(base, "jsnb", "settings.json"), "utf8")).toContain("old");
});
