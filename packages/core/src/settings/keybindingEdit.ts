// Editing a keybindings file: what keybindings.set and keybindings.reset change in one file, rule by
// rule, so the comments around the other rules survive.
import type { KeybindingRule } from "../model/keybinding.js";
import type { Keybinding } from "./keybindingDefaults.js";
import { keysText } from "./keybindingKeys.js";
import { sameArgs } from "./keybindings.js";
import { parseWhen } from "./keybindingWhen.js";

/** What a set or a reset is about: a command with its args, under one when clause (normalised). */
export type KeybindingTarget = {
  readonly command: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly when: string;
};

/** A rule's when clause normalised: "" for none on a binding, undefined for none on a removal (it matches any), the
 * text itself when it cannot be read. */
function ruleWhen(rule: KeybindingRule, removal: boolean): string | undefined {
  if (rule.when === undefined) return removal ? undefined : "";
  const read = parseWhen(rule.when);
  return "when" in read ? read.when.text : rule.when;
}

/** True when a file's rule is about `target`: its command (added or removed), when (a removal without one matches any)
 * and args (likewise). A reset with no args is about every binding of the command; an edit's (`exact`) target
 * without args is the binding without. */
function concerns(
  rule: KeybindingRule,
  target: Partial<KeybindingTarget> & { command: string },
  exact: boolean,
): boolean {
  const removal = rule.command.startsWith("-");
  if ((removal ? rule.command.slice(1) : rule.command) !== target.command) return false;
  const when = target.when === undefined ? undefined : ruleWhen(rule, removal);
  if (when !== undefined && when !== target.when) return false;
  if (target.args === undefined && !exact) return true;
  return (rule.args === undefined && removal) || sameArgs(rule.args, target.args);
}

/** The indices of `rules` a reset of `target` removes (no when or args: every one of the command's). */
export function keybindingResetIndices(
  rules: readonly KeybindingRule[],
  target: Partial<KeybindingTarget> & { readonly command: string },
): readonly number[] {
  return rules.flatMap((rule, index) => (concerns(rule, target, false) ? [index] : []));
}

/** How a file changes so that `target` has exactly `keys` (canonical) once the layers `below` it are applied: this
 * file's rules about the target go, then a removal for each key below that is not kept and a binding for each new key
 * (VS Code's editor writes the same pairs). */
export function keybindingEdit(change: {
  readonly rules: readonly KeybindingRule[];
  readonly below: readonly Keybinding[];
  readonly target: KeybindingTarget;
  readonly keys: readonly string[];
  readonly mac: boolean;
}): { readonly remove: readonly number[]; readonly add: readonly KeybindingRule[] } {
  const { rules, below, target, keys, mac } = change;
  const base = below
    .filter(
      (entry) =>
        entry.command === target.command &&
        entry.when === target.when &&
        sameArgs(entry.args, target.args),
    )
    .map((entry) => entry.key);
  const rule = (key: string, command: string): KeybindingRule => ({
    key: keysText(key, mac),
    command,
    ...(target.when === "" ? {} : { when: target.when }),
    ...(target.args === undefined ? {} : { args: { ...target.args } }),
  });
  const unique = [...new Set(keys)];
  return {
    remove: rules.flatMap((each, index) => (concerns(each, target, true) ? [index] : [])),
    add: [
      ...[...new Set(base)]
        .filter((key) => !unique.includes(key))
        .map((key) => rule(key, `-${target.command}`)),
      ...unique.filter((key) => !base.includes(key)).map((key) => rule(key, target.command)),
    ],
  };
}
