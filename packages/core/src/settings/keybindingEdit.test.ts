import { describe, expect, it } from "vitest";

import type { KeybindingRule } from "../model/keybinding.js";
import type { Keybinding } from "./keybindingDefaults.js";
import { keybindingEdit, keybindingResetIndices } from "./keybindingEdit.js";
import { resolveKeybindings } from "./keybindings.js";

const resolve = (user: KeybindingRule[], workspace: KeybindingRule[] = []) =>
  resolveKeybindings({ user, workspace }, true);
const apply = (rules: readonly KeybindingRule[], edit: ReturnType<typeof keybindingEdit>) => [
  ...rules.filter((_, index) => !edit.remove.includes(index)),
  ...edit.add,
];
const defaults = resolve([]).entries;
const keysIn = (entries: readonly Keybinding[], command: string) =>
  entries.filter((each) => each.command === command).map((each) => each.key);

describe("editing a file", () => {
  it("changes a default key as VS Code writes it: the old key removed, the new one bound", () => {
    const target = { command: "ui.palette.open", when: "" };
    const edit = keybindingEdit({
      rules: [],
      below: defaults,
      target,
      keys: ["Mod+Shift+P", "Mod+P"],
      mac: true,
    });
    expect(edit.add).toEqual([
      { key: "f1", command: "-ui.palette.open" },
      { key: "cmd+p", command: "ui.palette.open" },
    ]);
    const user = apply([], edit);
    expect(keysIn(resolve(user).entries, "ui.palette.open")).toEqual(["Mod+Shift+P", "Mod+P"]);
  });
});

describe("editing the user file again", () => {
  it("replaces the file's own rules for the target on a second change, keeping other rules", () => {
    const target = {
      command: "ui.cell.type",
      args: { type: "server" },
      when: "notebook && commandMode",
    };
    const other: KeybindingRule = { key: "cmd+r", command: "my.run" };
    const first = apply(
      [other],
      keybindingEdit({ rules: [other], below: defaults, target, keys: ["Alt+S"], mac: true }),
    );
    const second = apply(
      first,
      keybindingEdit({ rules: first, below: defaults, target, keys: ["Alt+X"], mac: true }),
    );
    expect(second).toEqual([
      other,
      {
        key: "t s",
        command: "-ui.cell.type",
        when: "notebook && commandMode",
        args: { type: "server" },
      },
      {
        key: "alt+x",
        command: "ui.cell.type",
        when: "notebook && commandMode",
        args: { type: "server" },
      },
    ]);
    // the markdown and client bindings of the same command are untouched
    expect(keysIn(resolve(second).entries, "ui.cell.type")).toEqual(["M", "T M", "T C", "Alt+X"]);
  });
});

describe("editing the workspace file", () => {
  it("unbinds with no keys, and writes the workspace's removals of the user's keys", () => {
    const user = apply(
      [],
      keybindingEdit({
        rules: [],
        below: defaults,
        target: { command: "ui.bottom.toggle", when: "notebook" },
        keys: ["Mod+Alt+J"],
        mac: true,
      }),
    );
    const below = resolve(user).entries;
    const workspace = apply(
      [],
      keybindingEdit({
        rules: [],
        below,
        target: { command: "ui.bottom.toggle", when: "notebook" },
        keys: [],
        mac: true,
      }),
    );
    expect(keysIn(resolve(user, workspace).entries, "ui.bottom.toggle")).toEqual([]);
    expect(workspace).toEqual([
      { key: "cmd+alt+j", command: "-ui.bottom.toggle", when: "notebook" },
    ]);
  });
});

describe("resetting", () => {
  it("resets a command's rules, all of them or one when and args", () => {
    const rules: KeybindingRule[] = [
      {
        key: "t s",
        command: "-ui.cell.type",
        when: "notebook && commandMode",
        args: { type: "server" },
      },
      {
        key: "alt+s",
        command: "ui.cell.type",
        when: "notebook && commandMode",
        args: { type: "server" },
      },
      {
        key: "alt+c",
        command: "ui.cell.type",
        when: "notebook && commandMode",
        args: { type: "client" },
      },
      { key: "cmd+r", command: "my.run" },
    ];
    expect(keybindingResetIndices(rules, { command: "ui.cell.type" })).toEqual([0, 1, 2]);
    expect(
      keybindingResetIndices(rules, { command: "ui.cell.type", args: { type: "server" } }),
    ).toEqual([0, 1]);
    expect(keybindingResetIndices(rules, { command: "ui.cell.type", when: "notebook" })).toEqual(
      [],
    );
    expect(keybindingResetIndices(rules, { command: "my.run", when: "" })).toEqual([3]);
  });
});
