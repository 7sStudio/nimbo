// `nimbo config get [key] [--user|--workspace] | set <key> <value> [--user|--workspace] | unset <key> [--user|--workspace]
// | path | schema` (03-api §4.10, 07-file-format §6): settings.get (the effective values, or what one file sets),
// settings.set (the value as JSON when it is JSON, else as text; unset is its reset), the two settings files' paths,
// settings.schema. As in VS Code, the workspace file outranks the user's.
import { homedir } from "node:os";
import { join, win32 } from "node:path";

import {
  productConfigDir,
  settingsFileName,
  settingsGet,
  settingsSchemaCommand,
  settingsSet,
  workspaceSettingsFolder,
} from "@jsnb/core";

import { checkedInput } from "../commands/parse.js";
import { findWorkspace } from "../daemon/workspace.js";
import { InvalidArguments } from "../errors/cli.js";
import { withLegacyConfigMoved } from "../install/legacyConfigDir.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import { table } from "../render/table.js";
import type { ShortcutArgs } from "./shortcut.js";
import { readShortcut, withSession } from "./shortcut.js";
import type { Shortcut } from "./shortcut.js";

const help = `nimbo config get|set|unset|path|schema: the settings (03-api §4.10)

Defaults < the user file < the workspace file (.jsnb/settings.json), as VS Code's user and workspace settings.

  get [key]              the effective values, each with where it comes from (default, user, workspace); with
                         --user or --workspace, only what that file sets
  set <key> <value>      write one key to the workspace file (the default), or to the user file with --user; the value
                         is read as JSON when it is JSON (14, true, "dark", [1]), else as text (dark)
  unset <key>            remove the key from the workspace file (or the user file with --user): the next source applies
  path                   the user and workspace settings files
  schema                 the settings' JSON Schema (settings.schema)

Flags:
  --user        the user file
  --workspace   the workspace file (the default for set and unset)
  --json        print the command's output as JSON
`;

/** The user settings file of 07-file-format §6, as the environment places it. */
function userSettingsPath(io: Io): string {
  const folder = productConfigDir(io.env, io.env.HOME ?? homedir(), io.platform);
  if (io.platform === "win32") return win32.join(folder, settingsFileName);
  return join(withLegacyConfigMoved(folder), settingsFileName);
}

/** The positionals' names in an issue, where a generated command names its flags. */
const labels = { key: "<key>", value: "<value>", scope: "--user" };

type Scope = "user" | "workspace";

/** --user or --workspace; both at once is a mistake. */
function scopeOf(args: ShortcutArgs): Scope | undefined {
  const user = args.values.user === true;
  const workspace = args.values.workspace === true;
  if (user && workspace)
    throw new InvalidArguments(
      { argument: "--workspace", command: "config" },
      "Use --user or --workspace, not both.",
    );
  return user ? "user" : workspace ? "workspace" : undefined;
}

/** JSON when the text is JSON, else the text (`dark`). */
const settingValue = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: a bare word is the string it spells.
    return text;
  }
};

const valueText = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

async function get(io: Io, args: ShortcutArgs, key: string | undefined): Promise<string> {
  const input = checkedInput(settingsGet, key === undefined ? {} : { key }, { key: "<key>" });
  const scope = scopeOf(args);
  const output = await withSession(io, { start: false, command: "config" }, (session) =>
    session.call(settingsGet, input),
  );
  if (scope !== undefined) {
    // what one file sets: the keys it holds with their values, as that tab of the Settings editor shows them
    const values = Object.fromEntries(
      Object.entries(output.values).flatMap(([name, entry]) =>
        entry[scope] === undefined ? [] : [[name, entry[scope]]],
      ),
    );
    if (args.json) return `${JSON.stringify({ scope, values })}\n`;
    const rows = Object.entries(values).map(([name, value]) => [name, valueText(value)]);
    return rows.length === 0 ? `the ${scope} settings set nothing\n` : table(rows);
  }
  if (args.json) return `${JSON.stringify(output)}\n`;
  return table(
    Object.entries(output.values).map(([name, entry]) => [
      name,
      valueText(entry.value),
      entry.source,
    ]),
  );
}

async function set(io: Io, args: ShortcutArgs, key: string, text: string): Promise<string> {
  const scope = scopeOf(args) ?? "workspace";
  const input = checkedInput(settingsSet, { key, value: settingValue(text), scope }, labels);
  const output = await withSession(io, { start: true, command: "config" }, (session) =>
    session.call(settingsSet, input),
  );
  return args.json
    ? `${JSON.stringify(output)}\n`
    : `${key} = ${valueText(output.value)} (${input.scope})\n`;
}

async function unset(io: Io, args: ShortcutArgs, key: string): Promise<string> {
  const scope = scopeOf(args) ?? "workspace";
  const input = checkedInput(settingsSet, { key, scope, reset: true }, labels);
  await withSession(io, { start: true, command: "config" }, (session) =>
    session.call(settingsSet, input),
  );
  const after = await withSession(io, { start: false, command: "config" }, (session) =>
    session.call(settingsGet, { key: input.key }),
  );
  if (args.json) return `${JSON.stringify(after)}\n`;
  const entry = after.values[key];
  return `${key} = ${valueText(entry?.value)} (${entry?.source ?? "default"})\n`;
}

async function paths(io: Io, args: ShortcutArgs): Promise<string> {
  const files = {
    user: userSettingsPath(io),
    workspace: join(await findWorkspace(io.cwd), workspaceSettingsFolder, settingsFileName),
  };
  return args.json
    ? `${JSON.stringify(files)}\n`
    : `user       ${files.user}\nworkspace  ${files.workspace}\n`;
}

async function schema(io: Io): Promise<string> {
  const output = await withSession(io, { start: false, command: "config" }, (session) =>
    session.call(settingsSchemaCommand, {}),
  );
  return `${JSON.stringify(output.schema, null, 2)}\n`;
}

type Verb = {
  readonly min: number;
  readonly max: number;
  readonly text: (io: Io, args: ShortcutArgs, words: readonly string[]) => Promise<string>;
};

const verbs: Readonly<Record<string, Verb>> = {
  get: { min: 0, max: 1, text: (io, args, [key]) => get(io, args, key) },
  set: { min: 2, max: 2, text: (io, args, [key, value]) => set(io, args, key ?? "", value ?? "") },
  unset: { min: 1, max: 1, text: (io, args, [key]) => unset(io, args, key ?? "") },
  path: { min: 0, max: 0, text: (io, args) => paths(io, args) },
  schema: { min: 0, max: 0, text: (io) => schema(io) },
};

async function textOf(io: Io, args: ShortcutArgs): Promise<string> {
  const [name = "", ...words] = args.positionals;
  const verb = verbs[name];
  if (verb === undefined || words.length < verb.min || words.length > verb.max) {
    throw new InvalidArguments(
      { argument: name === "" ? "config" : name, command: "config" },
      "Use nimbo config get [key], set <key> <value>, unset <key> (each with --user or --workspace), path or schema.",
    );
  }
  return verb.text(io, args, words);
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut(
    "config",
    argv,
    { user: { type: "boolean" }, workspace: { type: "boolean" } },
    { min: 0, max: 3 },
  );
  await write(io.stdout, args.help ? help : await textOf(io, args));
  return exitCodes.ok;
}

export const configShortcut: Shortcut = {
  name: "config",
  usage: "config get|set|unset|path|schema",
  summary: "the settings, user and workspace: get, set, unset, the files' paths, the schema",
  help,
  run,
};
