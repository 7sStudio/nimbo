// The keybindings files, VS Code's keybindings.json: a JSONC list of rules read with the tolerant
// parser (comments, trailing commas), and changed rule by rule through its edit API so the comments the user wrote
// survive keybindings.set; a rule the schema refuses is left out and reported.
import type { KeybindingRule } from "@jsnb/core";
import { InvalidParams, keybindingRuleSchema } from "@jsnb/core";
import type { ParseError } from "jsonc-parser";
import { applyEdits, modify, parse } from "jsonc-parser";

import { problemOf, readSettingsText, rewriteSettingsFile } from "./settingsFile.js";

export type KeybindingsFileRead = {
  /** The rules in the file's order, each with its index in the file. */
  readonly rules: readonly { readonly index: number; readonly rule: KeybindingRule }[];
  /** What could not be read: a parse problem (index -1) or a rule the schema refuses. */
  readonly problems: readonly { readonly index: number; readonly message: string }[];
};

/** The rules a JSONC text holds, and what could not be read. */
export function parseKeybindings(text: string): KeybindingsFileRead {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true, allowEmptyContent: true });
  const problems = errors.map((error) => ({ index: -1, message: problemOf(text, error) }));
  if (value === undefined) return { rules: [], problems };
  if (!Array.isArray(value))
    return {
      rules: [],
      problems: [...problems, { index: -1, message: "the file is not a JSON list" }],
    };
  const rules: { index: number; rule: KeybindingRule }[] = [];
  value.forEach((each: unknown, index) => {
    const read = keybindingRuleSchema.safeParse(each);
    if (read.success) rules.push({ index, rule: read.data });
    else
      problems.push({
        index,
        message: `rule ${String(index + 1)}: ${read.error.issues.map((issue) => `${issue.path.join(".") || "rule"} ${issue.message}`).join(", ")}`,
      });
  });
  return { rules, problems };
}

/** Reads one keybindings file; a missing file has no rules and no problem. */
export async function readKeybindingsFile(path: string): Promise<KeybindingsFileRead> {
  try {
    return parseKeybindings(await readSettingsText(path));
  } catch (error) {
    // a file nimbo will not read (a FIFO, too large) counts as none, with the reason
    return {
      rules: [],
      problems: [{ index: -1, message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

const formatting = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

/** `text` with the rules at `remove` (indices in the file) gone and `add` appended, comments kept. */
function editedKeybindings(
  text: string,
  remove: readonly number[],
  add: readonly KeybindingRule[],
): string {
  const empty = text.trim() === "";
  let next = empty ? "[]\n" : text;
  // a file that is not a list is never edited in place: the caller refuses it before
  for (const index of [...remove].toSorted((a, b) => b - a))
    next = applyEdits(next, modify(next, [index], undefined, { formattingOptions: formatting }));
  for (const rule of add) {
    const list: unknown = parse(next, [], { allowTrailingComma: true });
    const length = Array.isArray(list) ? list.length : 0;
    next = applyEdits(
      next,
      modify(next, [length], rule, { formattingOptions: formatting, isArrayInsertion: true }),
    );
  }
  return next.endsWith("\n") ? next : `${next}\n`;
}

/** A rule-by-rule change of the file at `path` (created when missing), computed from the file as it is read inside the
 * write, so two changes never lose one another: `change` gets the rules (indices are the file's) and answers which
 * indices go and which rules are appended. A file that is not a JSON list is refused. */
export const writeKeybindingsEdit = (
  path: string,
  change: (read: KeybindingsFileRead) => {
    readonly remove: readonly number[];
    readonly add: readonly KeybindingRule[];
  },
): Promise<void> =>
  rewriteSettingsFile(path, (text) => {
    const read = parseKeybindings(text);
    const broken = read.problems.find((each) => each.index === -1);
    if (broken !== undefined)
      throw new InvalidParams({
        issues: [{ path: ["file"], message: `${path} cannot be edited: ${broken.message}` }],
      });
    const { remove, add } = change(read);
    return editedKeybindings(text, remove, add);
  });
