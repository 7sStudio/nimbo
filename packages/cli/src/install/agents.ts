// The agents `mcp install` registers the MCP server with (03-api §8): Claude Code and VS Code through their own
// commands, Cursor and Claude Desktop by their JSON config files. What it registered is recorded in `<data>/mcp.json`
// for an installer install, so `uninstall` can take exactly those entries out again. The config files are edited in
// place, never rewritten from a parse: through a symbolic link, with their mode, comments and layout kept.
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, open, readFile, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve } from "node:path";

import { productName } from "@jsnb/core";
import type { FormattingOptions, ParseError } from "jsonc-parser";
import { applyEdits, modify, parse } from "jsonc-parser";
import { z } from "zod";

export type AgentId = "claude-code" | "vscode" | "cursor" | "claude-desktop";
export const agentIds: readonly AgentId[] = ["claude-code", "vscode", "cursor", "claude-desktop"];

export type Launch = { readonly command: string; readonly args: readonly string[] };

type Env = Readonly<Record<string, string | undefined>>;

export const onPath = (name: string, path: string): string | undefined =>
  path
    .split(delimiter)
    .filter((folder) => folder !== "")
    .map((folder) => join(folder, name))
    .find((file) => existsSync(file) && statSync(file).isFile());

const home = (env: Env): string => env.HOME ?? "";
const configHome = (env: Env): string =>
  env.XDG_CONFIG_HOME === undefined || env.XDG_CONFIG_HOME === ""
    ? join(home(env), ".config")
    : env.XDG_CONFIG_HOME;
const appSupport = (env: Env, platform: NodeJS.Platform, name: string): string =>
  platform === "darwin"
    ? join(home(env), "Library", "Application Support", name)
    : join(configHome(env), name);

export type Agent = {
  readonly id: AgentId;
  readonly label: string;
  /** The agent's command on PATH, for the agents registered through one. */
  readonly command?: string;
  /** The JSON file holding the entry, and the key of its server map. */
  readonly file?: string;
  readonly key?: "mcpServers" | "servers";
  readonly found: boolean;
};

/** The agents on this machine, found or not. */
export function agents(env: Env, platform: NodeJS.Platform): Agent[] {
  const path = env.PATH ?? "";
  const claude = onPath("claude", path);
  const code = onPath("code", path);
  const cursorDir = join(home(env), ".cursor");
  const desktopDir = appSupport(env, platform, "Claude");
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      ...(claude ? { command: claude } : {}),
      found: claude !== undefined,
    },
    {
      id: "vscode",
      label: "VS Code",
      ...(code ? { command: code } : {}),
      file: join(appSupport(env, platform, "Code"), "User", "mcp.json"),
      key: "servers",
      found: code !== undefined,
    },
    {
      id: "cursor",
      label: "Cursor",
      file: join(cursorDir, "mcp.json"),
      key: "mcpServers",
      found: existsSync(cursorDir) || onPath("cursor", path) !== undefined,
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      file: join(desktopDir, "claude_desktop_config.json"),
      key: "mcpServers",
      found: existsSync(desktopDir),
    },
  ];
}

const Json = z.record(z.string(), z.unknown());

const code = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** The file's text; undefined for a missing one. */
async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (code(error) === "ENOENT" || code(error) === "ENOTDIR") return undefined;
    throw error;
  }
}

/** A config file's JSON object, comments and trailing commas allowed (VS Code's mcp.json is JSONC); undefined for
 * text that is not one. */
function parseConfig(text: string): Record<string, unknown> | undefined {
  if (text.trim() === "") return {};
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) return undefined;
  const parsed = Json.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** A config file's JSON object; `{}` for a missing file, undefined for one that is not a JSON object or not readable. */
export async function readConfig(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    return parseConfig((await readText(file)) ?? "");
  } catch {
    return undefined;
  }
}

/** The entry a config file holds for the product under `key`, if any. */
export function entryIn(config: Record<string, unknown>, key: string): unknown {
  const servers = config[key];
  return typeof servers === "object" && servers !== null
    ? Reflect.get(servers, productName)
    : undefined;
}

/** The JSON a person adds by hand to a file this install cannot parse. */
export const entrySnippet = (key: string, entry: unknown): string =>
  JSON.stringify({ [key]: { [productName]: entry } }, null, 2);

/** The file a path names once its symbolic links are followed, the last one possibly missing. */
async function linkTarget(file: string): Promise<string> {
  let path = file;
  for (let hop = 0; hop < 40; hop += 1) {
    let link: string;
    try {
      link = await readlink(path);
    } catch (error) {
      if (["EINVAL", "ENOENT", "ENOTDIR"].includes(String(code(error)))) return path;
      throw error;
    }
    path = resolve(dirname(path), link);
  }
  throw new Error(`${file}: too many levels of symbolic links`);
}

/** The indentation and line ends the file already uses, two spaces for a file with none. */
function formattingOf(text: string): FormattingOptions {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /^([ \t]+)\S/mu.exec(text)?.[1];
  if (indent?.startsWith("\t") === true) return { insertSpaces: false, tabSize: 1, eol };
  return { insertSpaces: true, tabSize: indent?.length ?? 2, eol };
}

/** `text` with the product's entry set under `key`, or taken out for `undefined`; everything else as it was. */
function edited(
  text: string,
  config: Record<string, unknown>,
  key: string,
  entry: unknown,
): string {
  if (text.trim() === "") return entry === undefined ? text : `${entrySnippet(key, entry)}\n`;
  const servers = config[key];
  const isMap = typeof servers === "object" && servers !== null && !Array.isArray(servers);
  if (!isMap && entry === undefined) return text;
  const edits = isMap
    ? modify(text, [key, productName], entry, { formattingOptions: formattingOf(text) })
    : modify(text, [key], { [productName]: entry }, { formattingOptions: formattingOf(text) });
  return applyEdits(text, edits);
}

/** Replaces `target` with `text` by a file renamed over it in its own folder, keeping its mode and, when allowed, its
 * owner. A new file is 0600: Claude Desktop's may come to hold tokens in an entry's `env`. */
async function replaceFile(target: string, text: string): Promise<void> {
  const old = await stat(target).catch((error: unknown) => {
    if (code(error) === "ENOENT") return undefined;
    throw error;
  });
  const folder = dirname(target);
  await mkdir(folder, { recursive: true });
  const fresh = join(folder, `.${basename(target)}.${productName}-${randomUUID().slice(0, 8)}`);
  try {
    const handle = await open(fresh, "wx", 0o600);
    try {
      await handle.writeFile(text);
      if (old !== undefined) {
        await handle.chmod(old.mode & 0o7777);
        await handle.chown(old.uid, old.gid).catch(() => undefined);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(fresh, target);
  } catch (error) {
    await rm(fresh, { force: true });
    throw error;
  }
}

export type EntryWrite = "changed" | "unchanged" | "unparsable";

/** Sets the product's entry in `file` under `key` (or takes it out, for `undefined`), through a symbolic link to the
 * file it names, keeping the file's mode, comments, indentation and other entries. A file that does not parse as a
 * JSON object is left as it is: "unparsable". */
export async function writeEntry(file: string, key: string, entry: unknown): Promise<EntryWrite> {
  const target = await linkTarget(file);
  const text = (await readText(target)) ?? "";
  const config = parseConfig(text);
  if (config === undefined) return "unparsable";
  const next = edited(text, config, key, entry);
  if (next === text) return "unchanged";
  await replaceFile(target, next);
  return "changed";
}

/** The entry this install writes for `agent`. */
export const entryFor = (agent: Agent, server: Launch): Record<string, unknown> =>
  agent.key === "servers"
    ? { type: "stdio", command: server.command, args: [...server.args] }
    : { command: server.command, args: [...server.args] };

/** The same server as `server`: the same command and arguments. */
export function sameEntry(entry: unknown, server: Launch): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const command: unknown = Reflect.get(entry, "command");
  const args: unknown = Reflect.get(entry, "args");
  return command === server.command && JSON.stringify(args ?? []) === JSON.stringify(server.args);
}

const Registration = z.object({
  agent: z.enum(["claude-code", "vscode", "cursor", "claude-desktop"]),
  scope: z.string().optional(),
  file: z.string().optional(),
  command: z.string(),
});
export type Registration = z.infer<typeof Registration>;
const Registrations = z.object({ registrations: z.array(Registration) });

const registrationsFile = (dataDir: string): string => join(dataDir, "mcp.json");

export async function readRegistrations(dataDir: string): Promise<Registration[]> {
  try {
    const parsed = Registrations.safeParse(
      JSON.parse(await readFile(registrationsFile(dataDir), "utf8")),
    );
    return parsed.success ? parsed.data.registrations : [];
  } catch {
    return [];
  }
}

/** Adds `added` to the record, one entry per agent and scope. */
export async function recordRegistrations(
  dataDir: string,
  added: readonly Registration[],
): Promise<void> {
  if (added.length === 0) return;
  const same = (a: Registration, b: Registration) => a.agent === b.agent && a.scope === b.scope;
  const kept = (await readRegistrations(dataDir)).filter((old) => !added.some((n) => same(old, n)));
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    registrationsFile(dataDir),
    `${JSON.stringify({ registrations: [...kept, ...added] }, null, 2)}\n`,
  );
}
