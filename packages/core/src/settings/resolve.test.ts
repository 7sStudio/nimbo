// Tests resolveSettings precedence and warnings, validateSetting and assertWritable.
import { describe, expect, it } from "vitest";

import { assertWritable, resolveSettings, validateSetting } from "./resolve.js";

describe("resolveSettings", () => {
  it("applies defaults, then the user file, then the workspace file, and says where each value came from", () => {
    const { values, warnings } = resolveSettings({
      user: { "ui.theme": "dark", "editor.fontSize": 14 },
      workspace: { "ui.theme": "light" },
    });
    expect(values["ui.theme"]).toEqual({
      value: "light",
      source: "workspace",
      user: "dark",
      workspace: "light",
    });
    expect(values["editor.fontSize"]).toEqual({ value: 14, source: "user", user: 14 });
    expect(values["editor.tabSize"]).toEqual({ value: 2, source: "default" });
    expect(warnings).toEqual([]);
  });

  it("ignores an invalid value with a warning naming the key and the file", () => {
    const { values, warnings } = resolveSettings({
      user: { "editor.fontSize": "big" },
      workspace: {},
    });
    expect(values["editor.fontSize"]).toEqual({ value: 13, source: "default" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ key: "editor.fontSize", file: "user" });
    expect(warnings[0]?.message).toMatch(
      /^editor\.fontSize in the user settings is invalid: .*; the default applies$/,
    );
    const lower = resolveSettings({
      user: { "ui.theme": "dark" },
      workspace: { "ui.theme": "sepia" },
    });
    // the refused workspace value is not the workspace's value either
    expect(lower.values["ui.theme"]).toEqual({ value: "dark", source: "user", user: "dark" });
  });
});

describe("resolveSettings with unknown keys", () => {
  it("keeps them and reports them", () => {
    const { unknown, warnings } = resolveSettings({
      user: { "ui.font": "mono" },
      workspace: { "x.y": 1 },
    });
    expect(unknown).toEqual({
      "ui.font": { value: "mono", file: "user" },
      "x.y": { value: 1, file: "workspace" },
    });
    expect(warnings.map((w) => w.message)).toEqual([
      "unknown key ui.font in the user settings kept",
      "unknown key x.y in the workspace settings kept",
    ]);
  });
});

describe("validateSetting", () => {
  it("returns the parsed value or an InvalidParams naming the key", () => {
    expect(validateSetting("outputs.expandDepth", 3)).toEqual({ ok: true, value: 3 });
    const result = validateSetting("ui.theme", "sepia");
    expect(!result.ok && result.error.name).toBe("InvalidParams");
    expect(!result.ok && result.error.data.issues[0]?.path).toEqual(["ui.theme"]);
  });
});

describe("assertWritable", () => {
  it("refuses planned keys with NotAvailable and accepts stable ones", () => {
    expect(assertWritable("ui.theme")).toEqual({ ok: true });
    const result = assertWritable("editor.keymap");
    expect(!result.ok && result.error.message).toBe("editor.keymap is not implemented yet.");
    expect(!result.ok && result.error.code).toBe(1009);
  });
});
