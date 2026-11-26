// The settings files: JSONC read with a tolerant parser (comments, trailing commas) and written
// back through the same parser's edit API, so a comment the user wrote survives settings.set; keys are flat dotted names.
// A settings file that is a symbolic link (a dotfiles manager's) is read through the link but never written: replacing
// it would cut the link, so settings.set answers SettingsUnusable, as `.env` does.
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { JsnbError } from "@jsnb/core";
import type { ParseError } from "jsonc-parser";
import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";

import { isSymbolicLink, writeAtomically } from "../atomicWrite.js";
import { inOrder } from "../writeQueue.js";
import { readRegularFile } from "../regularFile.js";

type Where = { readonly path: string; readonly reason: string };
const unusableMessage = ({ path, reason }: Where): string =>
  `The settings file ${path} cannot be written: ${reason}. Make it a regular file, or edit it by hand.`;

/** A settings file the daemon refuses to write (a symbolic link, a FIFO, a directory, too large). */
class SettingsUnusable extends JsnbError {
  declare readonly data: Where;
  constructor(data: Where, options: { readonly cause?: unknown } = {}) {
    super({ name: "SettingsUnusable", message: unusableMessage(data), data, ...options });
  }
}

/** A settings file is hand-written text: far below this. */
const maxSettingsBytes = 1024 * 1024;

export type SettingsFileRead = {
  /** The top-level keys and values; `{}` for a missing or unreadable file. */
  readonly values: Readonly<Record<string, unknown>>;
  /** What could not be read, for the log's warning (the file and the reason). */
  readonly problems: readonly string[];
};

/** A settings file is one JSON object of flat dotted keys; each value is checked against its key by core. */
const SettingsObject = z.record(z.string(), z.unknown());

/** A parse problem as an editor words it: "Line 3, column 5: property name expected". */
export function problemOf(text: string, error: ParseError): string {
  const before = text.slice(0, error.offset).split("\n");
  const line = before.length;
  const column = (before.at(-1)?.length ?? 0) + 1;
  const words = printParseErrorCode(error.error)
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .toLowerCase();
  return `Line ${String(line)}, column ${String(column)}: ${words}`;
}

/** The values a JSONC text holds, and the parse problems (a value is read as far as the text allows). */
export function parseSettings(text: string): SettingsFileRead {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true, allowEmptyContent: true });
  const problems = errors.map((error) => problemOf(text, error));
  if (value === undefined) return { values: {}, problems };
  const object = SettingsObject.safeParse(value);
  if (!object.success)
    return { values: {}, problems: [...problems, "the file is not a JSON object"] };
  return { values: object.data, problems };
}

/** Reads one settings file; a missing file is `{}` with no problem. */
export async function readSettingsFile(path: string): Promise<SettingsFileRead> {
  const read = await readRegularFile(path, maxSettingsBytes);
  if (read.kind === "missing") return { values: {}, problems: [] };
  if (read.kind === "refused") return { values: {}, problems: [read.reason] };
  return parseSettings(read.text);
}

const formatting = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

/** `text` with `key` set to `value`, comments and the other keys as they were. */
function withSetting(text: string, key: string, value: unknown): string {
  const base = text.trim() === "" ? "{}\n" : text;
  return applyEdits(base, modify(base, [key], value, { formattingOptions: formatting }));
}

/** Rewrites the file at `path` with `change` of its text ("" when missing), creating the file (and its folder); one
 * write at a time, never through a symbolic link. */
export function rewriteSettingsFile(path: string, change: (text: string) => string): Promise<void> {
  return inOrder(path, async () => {
    if (await isSymbolicLink(path)) {
      const reason =
        "it is a symbolic link, which nimbo does not write through (set the key in the file it names)";
      throw new SettingsUnusable({ path, reason });
    }
    const read = await readRegularFile(path, maxSettingsBytes);
    if (read.kind === "refused") throw new SettingsUnusable({ path, reason: read.reason });
    await mkdir(dirname(path), { recursive: true });
    await writeAtomically(path, change(read.kind === "read" ? read.text : ""));
  });
}

/** Writes `key` into the file at `path`, creating the file (and its folder) when missing; one write at a time. */
export function writeSettingsKey(path: string, key: string, value: unknown): Promise<void> {
  return rewriteSettingsFile(path, (text) => withSetting(text, key, value));
}

/** The file at `path` as text: "" when it is missing; a file nimbo would not read answers SettingsUnusable. */
export async function readSettingsText(path: string): Promise<string> {
  const read = await readRegularFile(path, maxSettingsBytes);
  if (read.kind === "refused") throw new SettingsUnusable({ path, reason: read.reason });
  return read.kind === "read" ? read.text : "";
}

/** Replaces the file at `path` with `text` as the user wrote it (Settings (JSON)), comments included; one write at a
 * time, never through a symbolic link. The text is checked by the caller. */
export function writeSettingsText(path: string, text: string): Promise<void> {
  return inOrder(path, async () => {
    if (await isSymbolicLink(path)) {
      const reason =
        "it is a symbolic link, which nimbo does not write through (edit the file it names)";
      throw new SettingsUnusable({ path, reason });
    }
    await mkdir(dirname(path), { recursive: true });
    await writeAtomically(path, text.endsWith("\n") ? text : `${text}\n`);
  });
}
