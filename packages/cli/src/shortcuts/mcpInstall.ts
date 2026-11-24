// `mcp install` (03-api §8, §9): registers the MCP server with the agents on this machine. Claude Code through its own
// `claude mcp add` (user scope by default, so every project gets it), VS Code through `code --add-mcp`, Cursor and
// Claude Desktop by their JSON config files; any other client gets the JSON entry to paste. The command registered is
// the launcher's absolute path, which an upgrade keeps, since a GUI agent does not see the shell's PATH. An entry that
// is there already with another command is replaced only when asked.
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { productName } from "@jsnb/core";

import { InvalidArguments } from "../errors/cli.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Agent, AgentId, Launch, Registration } from "../install/agents.js";
import {
  agentIds,
  agents,
  entryFor,
  entryIn,
  entrySnippet,
  onPath,
  readConfig,
  recordRegistrations,
  sameEntry,
  writeEntry,
} from "../install/agents.js";
import { findInstallation } from "../install/installation.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Screen } from "../io/screen.js";
import { withScreen } from "../io/screen.js";
import { readShortcut, stringOf } from "./shortcut.js";

const run = promisify(execFile);

const help = `${productName} mcp install: register the MCP server with your agents

Finds Claude Code, VS Code, Cursor and Claude Desktop, asks which to register "${productName} mcp" with (those
found are chosen), and for Claude Code in which scope; shows what it will run or write, then does it. An entry
already there with another command is kept unless you agree to replace it (--replace). It prints the JSON entry
for any other client. The server finds the workspace from the folder the agent runs it in.

Options:
  --agent <ids>      only these, comma-separated: claude-code, vscode, cursor, claude-desktop
  --scope <scope>    Claude Code's scope: user (default), project or local
  --replace          replace an entry that runs another command
  --print            only print the commands and the JSON, change nothing
  -y, --yes          do not ask: every agent found (or --agent), the default scope
`;

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** How an agent starts this install's MCP server: the launcher on PATH or the installer's, else Node on the CLI. */
async function launch(io: Io): Promise<Launch> {
  const installation = await findInstallation();
  const own =
    installation.versionDir === undefined
      ? undefined
      : real(join(installation.versionDir, "bin", productName));
  const found = onPath(productName, io.env.PATH ?? "");
  if (found !== undefined && (own === undefined || real(found) === own))
    return { command: found, args: ["mcp"] };
  if (installation.record !== undefined) return { command: installation.record.bin, args: ["mcp"] };
  if (own !== undefined) return { command: own, args: ["mcp"] };
  return {
    command: io.execPath,
    args: [fileURLToPath(new URL("../main.js", import.meta.url)), "mcp"],
  };
}

/** The `mcpServers` entry Claude Desktop and Cursor read (VS Code's `servers` takes the same with `type`). */
const snippet = (server: Launch) =>
  JSON.stringify(
    { mcpServers: { [productName]: { command: server.command, args: server.args } } },
    null,
    2,
  );

/** What a failed run printed on stderr, else its message. */
const failureText = (error: unknown): string => {
  const stderr: unknown = error instanceof Error ? Reflect.get(error, "stderr") : undefined;
  if (typeof stderr === "string" && stderr.trim() !== "") return stderr.trim().split("\n")[0] ?? "";
  return error instanceof Error ? error.message : String(error);
};

async function tryRun(
  command: string,
  args: readonly string[],
  io: Io,
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await run(command, [...args], {
      env: { ...io.env },
      timeout: 60_000,
    });
    return { ok: true, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    return { ok: false, output: failureText(error) };
  }
}

const quoted = (arg: string): string => (/[\s"{}]/u.test(arg) ? `'${arg}'` : arg);

const claudeArgs = (scope: string, server: Launch): string[] => [
  "mcp",
  "add",
  "--scope",
  scope,
  productName,
  "--",
  server.command,
  ...server.args,
];

const vscodeArg = (server: Launch): string =>
  JSON.stringify({ name: productName, type: "stdio", command: server.command, args: server.args });

/** What registering with `agent` does, in one line the person reads before agreeing. */
function action(screen: Screen, agent: Agent, server: Launch, scope: string): string {
  if (agent.id === "claude-code") {
    return `runs ${screen.accent(`claude mcp add --scope ${scope} ${productName} -- ${quoted(screen.path(server.command))} mcp`)}`;
  }
  if (agent.id === "vscode")
    return `runs ${screen.accent(`code --add-mcp '{"name":"${productName}",…}'`)}`;
  return `writes ${screen.accent(`"${productName}"`)} into ${screen.path(agent.file ?? "")}`;
}

type Context = {
  readonly io: Io;
  readonly server: Launch;
  readonly scope: string;
  readonly replace: boolean;
  readonly screen: Screen;
};

type Result = {
  readonly line: string;
  readonly tone: "ok" | "warn" | "fail";
  readonly done: boolean;
};

const kept: Result = {
  tone: "warn",
  line: "kept the entry there (--replace replaces it)",
  done: false,
};
const already: Result = { tone: "ok", line: "registered already", done: false };

/** Whether an entry already there may be replaced: asked, else --replace. */
const mayReplace = (context: Context, label: string): Promise<boolean> =>
  context.screen.confirm(
    `${label} already has a "${productName}" entry with another command. Replace it?`,
    { default: false, fallback: context.replace },
  );

async function registerClaude(context: Context, agent: Agent): Promise<Result> {
  const { io, server, scope } = context;
  const claude = agent.command ?? "claude";
  const existing = await tryRun(claude, ["mcp", "get", productName], io);
  if (existing.ok) {
    if (existing.output.includes(server.command)) return already;
    if (!(await mayReplace(context, "Claude Code"))) return kept;
    await tryRun(claude, ["mcp", "remove", "--scope", scope, productName], io);
  }
  // `mcp get` finds an entry in any scope, `mcp remove --scope` takes it out of one: another scope's entry stays.
  const other = await tryRun(claude, ["mcp", "get", productName], io);
  const added = await tryRun(claude, claudeArgs(scope, server), io);
  if (!added.ok)
    return { tone: "fail", line: `claude mcp add failed: ${added.output}`, done: false };
  return other.ok
    ? otherScope(scope, other.output)
    : { tone: "ok", line: `registered, ${scope} scope`, done: true };
}

/** Registered, but `mcp get` found an entry in another scope, which still runs another command. */
function otherScope(scope: string, output: string): Result {
  const named = /scope:\s*(user|project|local)/iu.exec(output)?.[1]?.toLowerCase();
  const remove = `claude mcp remove --scope ${named ?? "<scope>"} ${productName}`;
  const where = named === undefined ? "another" : `the ${named}`;
  return {
    tone: "warn",
    line: `registered, ${scope} scope; an entry in ${where} scope still runs another command (${remove})`,
    done: true,
  };
}

/** A config file that does not parse, left as it is, with the entry to add by hand. */
const byHand = (screen: Screen, file: string, key: string, entry: unknown): Result => ({
  tone: "fail",
  line: `${screen.path(file)} is not valid JSON, not touched: add this by hand:\n${entrySnippet(key, entry).replace(/^/gmu, "    ")}`,
  done: false,
});

async function writeConfig(context: Context, agent: Agent): Promise<Result> {
  const { io, server, screen } = context;
  const file = agent.file ?? "";
  if (agent.id === "vscode" && agent.command !== undefined) {
    const added = await tryRun(agent.command, ["--add-mcp", vscodeArg(server)], io);
    return added.ok
      ? { tone: "ok", line: "registered", done: true }
      : { tone: "fail", line: `code --add-mcp failed: ${added.output}`, done: false };
  }
  const key = agent.key ?? "mcpServers";
  const entry = entryFor(agent, server);
  try {
    if ((await writeEntry(file, key, entry)) === "unparsable")
      return byHand(screen, file, key, entry);
    return { tone: "ok", line: `registered in ${screen.path(file)}`, done: true };
  } catch (error) {
    return {
      tone: "fail",
      line: `could not write ${screen.path(file)}: ${failureText(error)}`,
      done: false,
    };
  }
}

async function registerFile(context: Context, agent: Agent): Promise<Result> {
  const file = agent.file ?? "";
  const config = await readConfig(file);
  if (config === undefined)
    return byHand(context.screen, file, agent.key ?? "mcpServers", entryFor(agent, context.server));
  const existing = entryIn(config, agent.key ?? "mcpServers");
  if (sameEntry(existing, context.server)) return already;
  if (existing !== undefined && !(await mayReplace(context, agent.label))) return kept;
  return writeConfig(context, agent);
}

async function register(context: Context, agent: Agent): Promise<Result> {
  const needs = agent.id === "claude-code" ? "claude" : agent.id === "vscode" ? "code" : undefined;
  if (needs !== undefined && agent.command === undefined)
    return { tone: "fail", line: `${needs} is not on PATH`, done: false };
  return agent.id === "claude-code" ? registerClaude(context, agent) : registerFile(context, agent);
}

async function unregisterClaude(io: Io, agent: Agent, registration: Registration): Promise<string> {
  if (agent.command === undefined) return `${agent.label}: claude is not on PATH any more`;
  const scope = registration.scope ?? "user";
  const removed = await tryRun(agent.command, ["mcp", "remove", "--scope", scope, productName], io);
  return removed.ok
    ? `${agent.label}: removed (${scope} scope)`
    : `${agent.label}: not there any more`;
}

/** Takes the product's entry out of what `registration` made; a line saying what was done. */
export async function unregister(io: Io, registration: Registration): Promise<string> {
  const agent = agents(io.env, io.platform).find((known) => known.id === registration.agent);
  if (agent === undefined) return "";
  if (registration.agent === "claude-code") return unregisterClaude(io, agent, registration);
  const file = registration.file ?? agent.file ?? "";
  const key = agent.key ?? "mcpServers";
  const config = await readConfig(file);
  const leftAlone = `${agent.label}: ${file} is not valid JSON, left alone: remove "${productName}" from "${key}" by hand`;
  if (config === undefined) return leftAlone;
  const entry = entryIn(config, key);
  if (entry === undefined) return `${agent.label}: not there any more`;
  if (!sameEntry(entry, { command: registration.command, args: ["mcp"] }))
    return `${agent.label}: the entry runs another command now, left alone`;
  const outcome = await writeEntry(file, key, undefined).catch(() => "unwritable" as const);
  return {
    unparsable: leftAlone,
    unwritable: `${agent.label}: ${file} could not be written: remove "${productName}" from "${key}" by hand`,
    changed: `${agent.label}: removed`,
    unchanged: `${agent.label}: removed`,
  }[outcome];
}

function chosenIds(value: string | undefined): readonly AgentId[] | undefined {
  if (value === undefined) return undefined;
  const ids = value.split(",").map((id) => id.trim());
  const wrong = ids.find((id) => !agentIds.some((known) => known === id));
  if (wrong !== undefined) {
    throw new InvalidArguments(
      { argument: "--agent", command: "mcp install" },
      `--agent takes ${agentIds.join(", ")}, not ${JSON.stringify(wrong)}.`,
    );
  }
  return agentIds.filter((id) => ids.includes(id));
}

async function printOnly(io: Io, server: Launch, scope: string, json: boolean): Promise<void> {
  if (json) {
    const entry = { command: server.command, args: server.args };
    const commands = {
      claudeCode: ["claude", ...claudeArgs(scope, server)],
      vscode: ["code", "--add-mcp", vscodeArg(server)],
      mcpServers: { [productName]: entry },
    };
    await write(io.stdout, `${JSON.stringify(commands)}\n`);
    return;
  }
  const lines = [
    "Claude Code:",
    `  claude ${claudeArgs(scope, server).map(quoted).join(" ")}`,
    "VS Code:",
    `  code --add-mcp '${vscodeArg(server)}'`,
    "Claude Desktop (claude_desktop_config.json), Cursor (~/.cursor/mcp.json) and other clients:",
    snippet(server),
  ];
  await write(io.stdout, `${lines.join("\n")}\n`);
}

async function pickScope(screen: Screen, given: string | undefined): Promise<string> {
  if (given !== undefined) return given;
  const scopes = ["user", "project", "local"] as const;
  const index = await screen.choose(
    "Claude Code scope",
    [
      { label: "user", hint: "every project on this machine" },
      { label: "project", hint: "this folder's .mcp.json, shared with the team" },
      { label: "local", hint: "this folder, only you" },
    ],
    { default: 0 },
  );
  return scopes[index] ?? "user";
}

type Flags = {
  readonly scope: string | undefined;
  readonly only: readonly AgentId[] | undefined;
  readonly replace: boolean;
};

/** The agents the person picked: those found are on; --agent picks without asking. */
async function pickAgents(screen: Screen, io: Io, only: Flags["only"]): Promise<Agent[]> {
  const all = agents(io.env, io.platform);
  const offered = only === undefined ? all : all.filter((agent) => only.includes(agent.id));
  const picks = await screen.chooseMany(
    `Register ${productName}'s MCP server with`,
    offered.map((agent) => ({
      label: agent.label,
      hint: agent.found ? "found" : "not found",
      checked: agent.found || only !== undefined,
    })),
  );
  return offered.filter((_agent, index) => picks[index] === true);
}

type Registered = { readonly agent: AgentId; readonly tone: Result["tone"]; readonly line: string };

/** Registers with each chosen agent and records what was made; what each one gave. */
async function apply(context: Context, chosen: readonly Agent[]): Promise<Registered[]> {
  const made: Registration[] = [];
  const results: Registered[] = [];
  for (const agent of chosen) {
    const result = await register(context, agent);
    results.push({ agent: agent.id, tone: result.tone, line: result.line });
    await context.screen.step(result.tone, agent.label, result.line);
    if (!result.done) continue;
    made.push({
      agent: agent.id,
      command: context.server.command,
      ...(agent.id === "claude-code" ? { scope: context.scope } : {}),
      ...(agent.file === undefined || agent.id === "claude-code" ? {} : { file: agent.file }),
    });
  }
  const installation = await findInstallation();
  if (installation.method === "installer" && installation.dataDir !== undefined)
    await recordRegistrations(installation.dataDir, made);
  return results;
}

async function interactiveInstall(
  screen: Screen,
  io: Io,
  server: Launch,
  flags: Flags,
): Promise<Registered[]> {
  const chosen = await pickAgents(screen, io, flags.only);
  if (chosen.length === 0) {
    await screen.line("No agent chosen; nothing was changed. The entry for any client:");
    await screen.line(snippet(server));
    return [];
  }
  const scope = chosen.some((agent) => agent.id === "claude-code")
    ? await pickScope(screen, flags.scope)
    : (flags.scope ?? "user");
  await screen.line();
  for (const agent of chosen)
    await screen.step("info", agent.label, action(screen, agent, server, scope));
  if (!(await screen.confirm("Go ahead?", { default: true }))) {
    await screen.line("Nothing was changed.");
    return [];
  }
  const results = await apply({ io, server, scope, replace: flags.replace, screen }, chosen);
  await screen.line();
  await screen.line(screen.dim("Any other client takes this entry:"));
  await screen.line(snippet(server));
  return results;
}

export async function mcpInstall(argv: readonly string[], io: Io): Promise<ExitCode> {
  const options = {
    print: { type: "boolean" },
    scope: { type: "string" },
    agent: { type: "string" },
    replace: { type: "boolean" },
  } as const;
  const args = readShortcut("mcp install", argv, options, { min: 0, max: 0 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const scope = stringOf(args.values.scope);
  if (scope !== undefined && !["user", "project", "local"].includes(scope)) {
    throw new InvalidArguments(
      { argument: "--scope", command: "mcp" },
      `--scope is user, project or local, not ${JSON.stringify(scope)}.`,
    );
  }
  const only = chosenIds(stringOf(args.values.agent));
  const server = await launch(io);
  if (args.values.print === true) {
    await printOnly(io, server, scope ?? "user", args.json);
    return exitCodes.ok;
  }
  const yes = args.values.yes === true || only !== undefined;
  const flags = { scope, only, replace: args.values.replace === true };
  return withScreen(io, "mcp install", { yes, json: args.json }, async (screen) => {
    const results = await interactiveInstall(screen, io, server, flags);
    if (args.json) await write(io.stdout, `${JSON.stringify({ agents: results })}\n`);
    return results.some((result) => result.tone === "fail") ? exitCodes.runError : exitCodes.ok;
  });
}
