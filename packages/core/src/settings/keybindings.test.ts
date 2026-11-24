import { describe, expect, it } from "vitest";

import type { KeybindingRule } from "../model/keybinding.js";
import { defaultKeybindings } from "./keybindingDefaults.js";
import { keysText, parseKeys } from "./keybindingKeys.js";
import {
  bindingFor,
  keybindingConflicts,
  liveKeybindings,
  platformKey,
  resolveKeybindings,
  startsChord,
} from "./keybindings.js";
import { parseWhen } from "./keybindingWhen.js";

const at = (...keys: string[]) => new Set(keys);
const resolve = (user: KeybindingRule[], workspace: KeybindingRule[] = [], mac = true) =>
  resolveKeybindings({ user, workspace }, mac);

describe("keys", () => {
  it("reads VS Code's words and the canonical form alike, modifiers in one order", () => {
    expect(parseKeys("shift+cmd+p", true)).toBe("Mod+Shift+P");
    expect(parseKeys("Mod+Shift+P", true)).toBe("Mod+Shift+P");
    expect(parseKeys("cmd+k   cmd+s", true)).toBe("Mod+K Mod+S");
    expect(parseKeys("alt+up", true)).toBe("Alt+ArrowUp");
    expect(parseKeys("esc", true)).toBe("Escape");
    expect(parseKeys("cmd++", true)).toBe("Mod++");
    expect(parseKeys("f12", true)).toBe("F12");
  });

  it("reads ctrl as the Control key on macOS and as Mod elsewhere", () => {
    expect(parseKeys("ctrl+space", true)).toBe("Ctrl+Space");
    expect(parseKeys("ctrl+space", false)).toBe("Mod+Space");
    expect(parseKeys("cmd+ctrl+x", true)).toBe("Mod+Ctrl+X");
  });

  it("refuses what is not keys: an unknown modifier or key, three combinations, nothing", () => {
    for (const text of ["hyper+x", "cmd+banana", "a b c", "", "cmd+"])
      expect(parseKeys(text, true)).toBeUndefined();
  });
});

describe("keys written back", () => {
  it("writes keys back in the file's words for the platform, and reads them again the same", () => {
    expect(keysText("Mod+K Mod+S", true)).toBe("cmd+k cmd+s");
    expect(keysText("Mod+K Mod+S", false)).toBe("ctrl+k ctrl+s");
    expect(keysText("Alt+ArrowDown", true)).toBe("alt+down");
    for (const { key } of defaultKeybindings) {
      expect(parseKeys(keysText(key, true), true)).toBe(key);
      expect(parseKeys(keysText(key, false), false)).toBe(platformKey(key, false));
    }
  });
});

describe("when clauses", () => {
  it("normalises the terms and refuses unknown keys or operators", () => {
    expect(parseWhen(" notebook&&!commandMode ")).toEqual({
      when: {
        text: "notebook && !commandMode",
        terms: [
          { key: "notebook", not: false },
          { key: "commandMode", not: true },
        ],
      },
    });
    expect(parseWhen(undefined)).toEqual({ when: { text: "", terms: [] } });
    expect(parseWhen("editorFocus")).toHaveProperty("problem");
    expect(parseWhen("notebook || home")).toHaveProperty("problem");
    expect(parseWhen("notebook &&")).toHaveProperty("problem");
  });
});

describe("resolving and acting", () => {
  it("has no conflict among the defaults and every default acts somewhere", () => {
    const { entries, problems } = resolve([]);
    expect(problems).toEqual([]);
    expect(keybindingConflicts(entries).every((each) => each.length === 0)).toBe(true);
    expect(liveKeybindings(entries)).toHaveLength(entries.length);
  });

  it("lets the most specific clause act, then the last binding (a markdown cell's Escape, a user key)", () => {
    const { entries } = resolve([{ key: "escape", command: "my.escape" }]);
    expect(
      bindingFor(entries, "Escape", at("notebook", "editMode", "markdownEditing"))?.command,
    ).toBe("ui.mode.command");
    expect(bindingFor(entries, "Escape", at("notebook", "commandMode"))?.command).toBe("my.escape");
    expect(bindingFor(entries, "A", at("notebook"))).toBeUndefined();
    expect(bindingFor(entries, "A", at("notebook", "commandMode"))?.command).toBe(
      "ui.cell.addAbove",
    );
  });

  it("removes earlier bindings with a `-` rule, by command and key, by when, or by args", () => {
    const { entries } = resolve(
      [
        { key: "f1", command: "-ui.palette.open" },
        { command: "-ui.cell.type", args: { type: "server" } },
      ],
      [{ command: "-ui.select.next", when: "notebook && commandMode" }],
    );
    const keysOf = (command: string) =>
      entries.filter((each) => each.command === command).map((each) => each.key);
    expect(keysOf("ui.palette.open")).toEqual(["Mod+Shift+P"]);
    expect(entries.some((each) => each.key === "T S")).toBe(false);
    expect(keysOf("ui.cell.type")).toEqual(["M", "T M", "T C"]);
    expect(keysOf("ui.select.next")).toEqual([]);
    expect(keysOf("ui.home.select.next")).toEqual(["ArrowDown", "J"]);
  });
});

describe("rules that cannot be read", () => {
  it("reports and skips rules that cannot be read, keeping the rest", () => {
    const { entries, problems } = resolve(
      [
        { key: "cmd+banana", command: "a.b" },
        { command: "c.d" },
        { key: "x", command: "e.f", when: "nowhere" },
        { key: "x", command: "-" },
        { key: "cmd+r", command: "notebook.run", args: { select: "all" } },
      ],
      [],
    );
    expect(problems.map((each) => each.index)).toEqual([0, 1, 2, 3]);
    expect(problems.every((each) => each.file === "user")).toBe(true);
    expect(entries.at(-1)).toMatchObject({
      key: "Mod+R",
      command: "notebook.run",
      source: "user",
      when: "",
    });
  });
});

describe("chords, conflicts and live bindings", () => {
  it("knows a chord's first key where the chord can act", () => {
    const { entries } = resolve([]);
    expect(startsChord(entries, "D", at("notebook", "commandMode"))).toBe(true);
    expect(startsChord(entries, "D", at("notebook", "editMode"))).toBe(false);
    expect(startsChord(entries, "Mod+K", at("home"))).toBe(true);
  });

  it("finds a conflict of equal specificity and drops the shadowed binding from the live ones", () => {
    const { entries } = resolve([{ key: "cmd+b", command: "my.thing", when: "notebook" }]);
    const conflicts = keybindingConflicts(entries);
    const panel = entries.findIndex((each) => each.command === "ui.panel.toggle");
    const mine = entries.findIndex((each) => each.command === "my.thing");
    expect(conflicts[panel]?.map((each) => each.command)).toEqual(["my.thing"]);
    expect(conflicts[mine]?.map((each) => each.command)).toEqual(["ui.panel.toggle"]);
    // Home's Cmd B never holds on the notebook page: no conflict
    const home = entries.findIndex((each) => each.command === "ui.home.side.toggle");
    expect(conflicts[home]).toEqual([]);
    const live = liveKeybindings(entries, "notebook").map((each) => each.command);
    expect(live).toContain("my.thing");
    expect(live).not.toContain("ui.panel.toggle");
    expect(liveKeybindings(entries, "home").map((each) => each.command)).toContain(
      "ui.home.side.toggle",
    );
  });

  it("counts a less specific binding shadowed only where the specific one holds, so it stays live", () => {
    const { entries } = resolve([{ key: "a", command: "my.a" }]);
    const conflicts = keybindingConflicts(entries);
    expect(conflicts[entries.findIndex((each) => each.command === "my.a")]).toEqual([]);
    expect(bindingFor(entries, "A", at("notebook", "commandMode"))?.command).toBe(
      "ui.cell.addAbove",
    );
    expect(bindingFor(entries, "A", at("home", "commandMode"))?.command).toBe("my.a");
  });
});

describe("the debugger's keys", () => {
  it("acts with the debugger's keys only in their debug state, and a user's rebinding keeps its clause", () => {
    const paused = at("notebook", "commandMode", "inDebugMode", "debugPaused");
    const running = at("notebook", "commandMode", "inDebugMode", "debugRunning");
    const { entries } = resolve([
      { key: "f5", command: "-ui.debug.continue" },
      { key: "f8", command: "ui.debug.continue", when: "notebook && debugPaused" },
    ]);
    expect(bindingFor(entries, "F5", at("notebook", "commandMode"))).toBeUndefined();
    expect(bindingFor(entries, "F5", paused)).toBeUndefined();
    expect(bindingFor(entries, "F8", paused)?.command).toBe("ui.debug.continue");
    expect(bindingFor(entries, "F8", running)).toBeUndefined();
    expect(bindingFor(entries, "F6", running)?.command).toBe("ui.debug.pause");
    expect(
      bindingFor(entries, "F6", at("notebook", "fieldFocus", "inDebugMode", "debugRunning")),
    ).toBe(undefined);
    expect(liveKeybindings(entries, "notebook").map((each) => each.key)).toContain("F8");
  });
});
