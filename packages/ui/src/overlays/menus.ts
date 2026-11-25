// The items of the menus as data: the cell menu, the type menu and the restart menu. Each item names a
// command id with its arguments, never a function; its shortcut comes from the keymap, its line of consequence (the
// restart menu's) from here.
import type { CellType } from "@jsnb/core";
import {
  GitCompare,
  ArrowDown,
  ArrowUp,
  ChevronsDownUp,
  ChevronsDown,
  ChevronsUp,
  CircleSlash,
  Copy,
  Hand,
  ListTree,
  Monitor,
  Pencil,
  Pin,
  Play,
  RotateCcw,
  Server,
  Shapes,
  Square,
  TextAlignStart,
  Trash2,
  Workflow,
} from "@lucide/vue";
import type { Component } from "vue";

import type { Args } from "../commands/command.js";
import { keysFor } from "../keyboard/keymap.js";
import { typeName } from "../cells/types.js";

export type MenuItem =
  | {
      readonly kind: "item";
      readonly label: string;
      /** The Lucide icon before the label (board 12). */
      readonly icon?: Component;
      readonly command: string;
      readonly args?: Args;
      /** The keymap's keys, as keymap.ts writes them. */
      readonly keys?: string;
      /** One line under the label saying what it does. */
      readonly hint?: string;
      readonly destructive?: boolean;
      /** Marked as the current choice (the cell's type). */
      readonly current?: boolean;
    }
  | { readonly kind: "separator" }
  | {
      readonly kind: "sub";
      readonly label: string;
      readonly icon?: Component;
      readonly items: readonly MenuItem[];
    };

const types: readonly CellType[] = ["server", "client", "markdown"];
/** The type icons of cells/TypeIcon.vue. */
const typeIcons: Readonly<Record<CellType, Component>> = {
  server: Server,
  client: Monitor,
  markdown: TextAlignStart,
};

type Item = Extract<MenuItem, { kind: "item" }>;

function item(label: string, command: string, args?: Args, extra: Partial<Item> = {}): Item {
  const keys = keysFor(command, args);
  return {
    kind: "item",
    label,
    command,
    ...(args === undefined ? {} : { args }),
    ...(keys === undefined ? {} : { keys }),
    ...extra,
  };
}

const separator: MenuItem = { kind: "separator" };

/** Server, Client and Markdown, the cell's own marked current. */
/** The type menu's items; `toCode` (Y) offers server and client for the marked markdown cells alone. */
export function typeItems(current: CellType, toCode = false): readonly MenuItem[] {
  const offered = toCode ? types.filter((type) => type !== "markdown") : types;
  return offered.map((type) =>
    item(typeName[type], "ui.cell.type", toCode ? { type, from: "markdown" } : { type }, {
      icon: typeIcons[type],
      ...(type === current ? { current: true } : {}),
    }),
  );
}

/** The cell menu's run items: a markdown cell renders, and has nothing that depends on it. */
const runItems = (code: boolean): (MenuItem | false)[] => [
  item(code ? "Run" : "Render", "ui.run.inPlace", undefined, { icon: Play }),
  code && item("Run with Dependents", "ui.run.withDependents", undefined, { icon: Workflow }),
  item("Run All Above", "ui.run.above", undefined, { icon: ChevronsUp }),
  code && item("Run Cell and Below", "ui.run.below", undefined, { icon: ChevronsDown }),
];

/** A code cell's view items: its values, its fold, the inspector and auto-run. */
const viewItems = (state: {
  values: boolean;
  collapsed: boolean;
  pinned?: boolean;
  manual?: boolean;
}): MenuItem[] => [
  item(state.values ? "Hide Values" : "Show Values", "ui.cell.toggleValues", undefined, {
    icon: ListTree,
  }),
  item(state.collapsed ? "Unfold" : "Fold", "ui.cell.toggleCollapse", undefined, {
    icon: ChevronsDownUp,
  }),
  item(state.pinned === true ? "Unpin" : "Pin to Inspector", "ui.cell.pin", undefined, {
    icon: Pin,
  }),
  item(
    state.manual === true ? "Allow Auto-Run" : "Run Manually Only",
    "ui.cell.toggleManual",
    undefined,
    {
      icon: Hand,
    },
  ),
];

/** The cell menu of a cell of `type` (a markdown cell has no values view and nothing that depends on it). */
export function cellMenuItems(
  type: CellType,
  state: { values: boolean; collapsed: boolean; pinned?: boolean; manual?: boolean },
) {
  const code = type !== "markdown";
  const items: (MenuItem | false)[] = [
    ...runItems(code),
    separator,
    { kind: "sub", label: "Change Type", icon: Shapes, items: typeItems(type) },
    ...(code ? viewItems(state) : []),
    ...(code
      ? [
          item("Compare with Previous Run", "ui.cell.compare", undefined, { icon: GitCompare }),
          item("Clear Output", "ui.cell.clearOutput", undefined, { icon: CircleSlash }),
        ]
      : []),
    separator,
    item("Rename", "ui.cell.rename", undefined, { icon: Pencil }),
    item("Move Up", "ui.cell.moveUp", undefined, { icon: ArrowUp }),
    item("Move Down", "ui.cell.moveDown", undefined, { icon: ArrowDown }),
    item("Copy Cell ID", "ui.cell.copyId", undefined, { icon: Copy }),
    separator,
    item("Delete", "cell.delete", undefined, { destructive: true, icon: Trash2 }),
  ];
  return items.filter((each): each is MenuItem => each !== false);
}

/** The restart menu: the Run menu's words for the same three commands, no sentence under them. */
export const restartItems: readonly MenuItem[] = [
  item("Restart Kernel", "kernel.restart", undefined, { icon: RotateCcw }),
  item("Restart Kernel and Page", "kernel.restart", { all: true }, { icon: RotateCcw }),
  item("Interrupt", "kernel.interrupt", undefined, { icon: Square }),
];
