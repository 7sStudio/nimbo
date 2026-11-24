// What the Keyboard Shortcuts editor's actions write: a row's command gets its new list of keys under its
// when clause through keybindings.set, in the file of the scope tab, as VS Code's editor writes keybindings.json:
// Change Keybinding replaces the row's key, Add Keybinding adds one, Remove Keybinding takes it away, Change When
// Expression moves it to another clause, Reset Keybinding removes what both files say about the row's command.
import type { Keybinding } from "@jsnb/core";
import { keysText, parseWhen, sameArgs } from "@jsnb/core";
import type { Ref } from "vue";

import type { KeyRow } from "../keyboard/keybindingRows.js";
import type { KeyTarget } from "../store/keybindings.js";
import { useKeybindingsStore } from "../store/keybindings.js";
import type { Scope } from "../store/settings.js";

/** The keys `target`'s command has now under its when clause. */
const keysUnder = (entries: readonly Keybinding[], target: KeyTarget): readonly string[] =>
  entries
    .filter(
      (each) =>
        each.command === target.command &&
        each.when === target.when &&
        sameArgs(each.args, target.args),
    )
    .map((each) => each.key);

type Write = (target: KeyTarget, keys: readonly string[]) => Promise<void>;

/** The row's key added under `text`'s clause, then taken from its own; the problem with `text`, or null. */
async function moveWhen(
  entries: () => readonly Keybinding[],
  write: Write,
  row: KeyRow,
  text: string,
): Promise<string | null> {
  const read = parseWhen(text);
  if ("problem" in read) return read.problem;
  const key = row.keys[0];
  const target = row.target;
  if (target === null || key === undefined || read.when.text === target.when) return null;
  const moved = { ...target, when: read.when.text };
  await write(moved, [...keysUnder(entries(), moved), key]);
  await write(
    target,
    keysUnder(entries(), target).filter((each) => each !== key),
  );
  return null;
}

export function keybindingActions(context: {
  readonly entries: () => readonly Keybinding[];
  readonly scope: Ref<Scope>;
  readonly mac: boolean;
}) {
  const store = useKeybindingsStore();
  const { entries, scope, mac } = context;
  const write: Write = async (target, keys) => {
    await store.set(
      target,
      keys.map((each) => keysText(each, mac)),
      scope.value,
    );
  };
  return {
    /** Change Keybinding (the row's key replaced, or the first key of an unbound row) or Add Keybinding. */
    record: async (row: KeyRow, keys: string, mode: "change" | "add") => {
      if (row.target === null) return;
      const now = keysUnder(entries(), row.target);
      const old = row.keys[0];
      const next =
        mode === "add" || old === undefined
          ? [...now, keys]
          : now.map((each) => (each === old ? keys : each));
      await write(row.target, next);
    },
    remove: async (row: KeyRow) => {
      const key = row.keys[0];
      if (row.target === null || key === undefined) return;
      await write(
        row.target,
        keysUnder(entries(), row.target).filter((each) => each !== key),
      );
    },
    reset: async (row: KeyRow) => {
      if (row.target !== null) await store.reset(row.target, undefined);
    },
    /** Change When Expression: the row's key moves to `text`'s clause; the problem with `text`, or null. */
    moveWhen: (row: KeyRow, text: string) => moveWhen(entries, write, row, text),
  };
}
