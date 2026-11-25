// Tests the Settings panel's fields from the real settings schema (core's settingsJsonSchema, what settings.schema
// returns): groups by prefix, controls from the JSON Schema, planned keys, and what a typed value becomes.
import { settingsJsonSchema, settingsKeys } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { controlOf, groupsOf, matching, parsed } from "./settingsFields.js";

const groups = groupsOf(settingsJsonSchema());
const field = (key: string) => groups.flatMap((g) => g.fields).find((f) => f.key === key);

/** The schema's planned keys, which the panel leaves out. */
const planned = new Set(["editor.keymap", "secrets.allowLiveKeys"]);

describe("settings fields", () => {
  it("lists every key once, grouped by its prefix in the schema's order", () => {
    // a planned key is not offered
    expect(groups.flatMap((g) => g.fields.map((f) => f.key))).toEqual(
      settingsKeys.filter((key) => !planned.has(key)),
    );
    expect(groups.map((g) => g.name)).toContain("Interface");
    expect(groups[0]?.name).toBe("Bridge");
  });

  it("reads each control from the schema", () => {
    expect(field("packages.manager")?.control).toEqual({
      kind: "select",
      options: ["auto", "pnpm", "npm", "yarn", "bun"],
    });
    expect(field("editor.wordWrap")?.control).toEqual({ kind: "switch" });
    expect(field("bridge.rpcTimeoutMs")?.control).toEqual({ kind: "number", min: 1 });
    expect(field("outputs.expandDepth")?.control).toEqual({ kind: "number", min: 0 });
    expect(field("kernel.nodePath")?.control).toEqual({ kind: "text", nullable: true });
    expect(controlOf({ type: "string" })).toEqual({ kind: "text", nullable: false });
  });

  it("leaves planned keys out and keeps titles", () => {
    expect(field("editor.keymap")).toBeUndefined();
    expect(field("ui.theme")).toMatchObject({ title: "Theme" });
  });

  it("turns typed text into a value or an error", () => {
    const number = { kind: "number", min: 1 } as const;
    expect(parsed(number, " 42 ")).toEqual({ value: 42 });
    expect(parsed(number, "0")).toEqual({ error: "At least 1." });
    expect(parsed(number, "1.5")).toEqual({ error: "A whole number." });
    expect(parsed(number, "")).toEqual({ error: "A whole number." });
    expect(parsed({ kind: "text", nullable: true }, " ")).toEqual({ value: null });
    expect(parsed({ kind: "text", nullable: false }, "")).toEqual({ value: "" });
  });

  it("answers no groups for a schema without properties", () => {
    expect(groupsOf({})).toEqual([]);
    expect(groupsOf({ properties: { a: 1 } })).toEqual([]);
  });
});

describe("settings search", () => {
  const found = (query: string) =>
    matching(groups, query).flatMap((g) => g.fields.map((f) => f.key));
  it("finds a key however it is written, and a line pasted from a settings file by its key", () => {
    for (const query of [
      "editor.fontSize",
      "editor.font-size",
      "EDITOR FONTSIZE",
      '"editor.fontSize": 12',
    ])
      expect(found(query)).toEqual(["editor.fontSize"]);
    expect(found("font size")).toContain("editor.fontSize");
    expect(found("no such setting")).toEqual([]);
  });
});
