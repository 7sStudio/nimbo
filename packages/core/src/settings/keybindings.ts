// Keybindings as VS Code has them (03-api §4.11, 07-file-format §6): the default table, then the user's
// keybindings.json, then the workspace's, each file a list of rules applied in order (a rule adds a binding; a rule whose
// command starts with `-` removes the earlier bindings it matches). A binding acts where its when clause holds; where
// several bindings of one key hold, the most specific clause wins (more terms), then the one defined last, so a
// markdown cell's Escape outranks the page's and the user's key outranks the default. Two bindings of one key that can
// hold in the same place with the same specificity conflict: only the later one acts there.
import type { KeybindingFiles, KeybindingRule, KeybindingSource } from "../model/keybinding.js";
import type { Keybinding } from "./keybindingDefaults.js";
import { defaultKeybindings } from "./keybindingDefaults.js";
import { parseKeys } from "./keybindingKeys.js";
import { parseWhen, whenContexts, whenHolds, whenTerms } from "./keybindingWhen.js";

/** True when two argument records are the same (none is `{}`). */
export const sameArgs = (
  a: Readonly<Record<string, unknown>> | undefined,
  b: Readonly<Record<string, unknown>> | undefined,
): boolean => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/** What a file's rule gets wrong: the file, the rule's index, the words. */
export type KeybindingProblem = {
  readonly file: "user" | "workspace";
  readonly index: number;
  readonly message: string;
};

type Read =
  | { readonly kind: "add"; readonly binding: Keybinding }
  | {
      readonly kind: "remove";
      readonly command: string;
      readonly key?: string;
      readonly when?: string;
      readonly args?: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: "problem"; readonly message: string };

/** A rule's key and when clause read, or the problem with either. */
function readParts(
  rule: KeybindingRule,
  mac: boolean,
): { readonly key?: string; readonly when?: string } | { readonly problem: string } {
  const key = rule.key === undefined ? undefined : parseKeys(rule.key, mac);
  if (rule.key !== undefined && key === undefined) return { problem: `"${rule.key}" is not a key` };
  const when = rule.when === undefined ? undefined : parseWhen(rule.when);
  if (when !== undefined && "problem" in when) return { problem: when.problem };
  return {
    ...(key === undefined ? {} : { key }),
    ...(when === undefined ? {} : { when: when.when.text }),
  };
}

/** One rule read with `mac`'s keys. */
function readRule(rule: KeybindingRule, source: KeybindingSource, mac: boolean): Read {
  const removal = rule.command.startsWith("-");
  const command = removal ? rule.command.slice(1) : rule.command;
  if (command === "") return { kind: "problem", message: `"${rule.command}" names no command` };
  const parts = readParts(rule, mac);
  if ("problem" in parts) return { kind: "problem", message: parts.problem };
  const args = rule.args === undefined ? {} : { args: rule.args };
  if (removal) return { kind: "remove", command, ...parts, ...args };
  const { key, when = "" } = parts;
  if (key === undefined)
    return { kind: "problem", message: `the binding of ${command} has no key` };
  return { kind: "add", binding: { key, command, when, ...args, source } };
}

const removes = (read: Extract<Read, { kind: "remove" }>, entry: Keybinding): boolean =>
  entry.command === read.command &&
  (read.key === undefined || entry.key === read.key) &&
  (read.when === undefined || entry.when === read.when) &&
  (read.args === undefined || sameArgs(entry.args, read.args));

/** A default key on this platform: the Control key of a default (VS Code's Ctrl Shift G on every platform) is Mod
 * outside macOS, where Mod is Ctrl. */
export const platformKey = (key: string, mac: boolean): string =>
  mac ? key : key.replaceAll("Ctrl+", "Mod+");

/** The defaults with the user's rules, then the workspace's, applied in order; rules that cannot be read are left out
 * and reported. `mac` reads the files' keys (cmd and ctrl). */
export function resolveKeybindings(
  files: KeybindingFiles,
  mac: boolean,
): { readonly entries: readonly Keybinding[]; readonly problems: readonly KeybindingProblem[] } {
  let entries: Keybinding[] = defaultKeybindings.map((each) => ({
    ...each,
    key: platformKey(each.key, mac),
    source: "default",
  }));
  const problems: KeybindingProblem[] = [];
  for (const file of ["user", "workspace"] as const) {
    files[file].forEach((rule, index) => {
      const read = readRule(rule, file, mac);
      if (read.kind === "problem") problems.push({ file, index, message: read.message });
      else if (read.kind === "add") entries.push(read.binding);
      else entries = entries.filter((entry) => !removes(read, entry));
    });
  }
  return { entries, problems };
}

const rankOf = (entry: Keybinding): number => whenTerms(entry.when);

/** The binding that acts for `key` where `context` is: of those whose clause holds, the most specific, then the last. */
export function bindingFor(
  entries: readonly Keybinding[],
  key: string,
  context: ReadonlySet<string>,
): Keybinding | undefined {
  let found: Keybinding | undefined;
  for (const entry of entries) {
    if (entry.key !== key || !whenHolds(entry.when, context)) continue;
    if (found === undefined || rankOf(entry) >= rankOf(found)) found = entry;
  }
  return found;
}

/** True when a binding that holds where `context` is starts with `key` and has a second key. */
export const startsChord = (
  entries: readonly Keybinding[],
  key: string,
  context: ReadonlySet<string>,
): boolean =>
  entries.some((entry) => entry.key.startsWith(`${key} `) && whenHolds(entry.when, context));

/** The bindings that act somewhere: neither shadowed everywhere they hold nor never able to hold (a menu's shortcut,
 * a tooltip). `page` keeps those that act on that page. */
export function liveKeybindings(
  entries: readonly Keybinding[],
  page?: "home" | "notebook",
): readonly Keybinding[] {
  const places = page === undefined ? whenContexts : whenContexts.filter((each) => each.has(page));
  return entries.filter((entry) =>
    places.some(
      (context) =>
        whenHolds(entry.when, context) && bindingFor(entries, entry.key, context) === entry,
    ),
  );
}

const sameBinding = (a: Keybinding, b: Keybinding): boolean =>
  a.command === b.command && sameArgs(a.args, b.args);

/** For each entry (by index), the other entries of its key that can hold in the same place with the same
 * specificity, so that one of the two never acts there; a second binding of the same command is no conflict. */
export function keybindingConflicts(
  entries: readonly Keybinding[],
): readonly (readonly Keybinding[])[] {
  return entries.map((entry) =>
    entries.filter(
      (other) =>
        other !== entry &&
        other.key === entry.key &&
        !sameBinding(entry, other) &&
        rankOf(other) === rankOf(entry) &&
        whenContexts.some(
          (context) => whenHolds(entry.when, context) && whenHolds(other.when, context),
        ),
    ),
  );
}
