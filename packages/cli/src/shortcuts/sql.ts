// `sql status` and `sql install` read for a person (03-api §4.16, §8): where DuckDB goes and how big it is, a progress
// line while it installs, and how to remove it. The workspace's daemon does it when one runs (it uses DuckDB at once);
// with none, the server's install runs in a process of its own, so no workspace and no daemon are needed. With --json or --help they are the registry's generated
// commands, unchanged, as is any other `sql` verb.
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import type { EventEnvelope } from "@jsnb/core";
import { JsnbError, productName, sqlInstall, sqlStatus } from "@jsnb/core";
import { z } from "zod";

import { domainHelp } from "../commands/help.js";
import { runGenerated } from "../commands/invoke.js";
import { findCommand } from "../commands/names.js";
import type { Session } from "../daemon/session.js";
import { markedWorkspace } from "../daemon/workspace.js";
import { InvalidArguments } from "../errors/cli.js";
import { DaemonNotRunning } from "../errors/daemon.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Screen } from "../io/screen.js";
import { shellWord, withScreen } from "../io/screen.js";
import type { Shortcut } from "./shortcut.js";
import { readShortcut, withSession } from "./shortcut.js";

/** What the binding takes on disk, as the release notes give it. */
const about = "about 40 MB";

type Status = {
  readonly installed: boolean;
  readonly version: string;
  readonly source: string;
  readonly folder: string;
};

const sourceText = (source: string): string =>
  source === "dependency" ? "beside the daemon (a checkout)" : "in the data folder";

async function showStatus(screen: Screen, status: Status): Promise<void> {
  await screen.heading("DuckDB for SQL from the CLI and agents");
  await screen.rows([
    [
      "status",
      status.installed
        ? `${screen.toned("ok", "installed")}, ${status.version}, ${sourceText(status.source)}`
        : screen.toned("warn", "not installed"),
    ],
    ["folder", screen.path(status.folder)],
  ]);
  if (!status.installed) {
    await screen.line(`  ${screen.dim(`Install it (${about}):`)}`);
    await screen.command(`${productName} sql install`);
  }
}

type Step = { readonly step: string; readonly index: number; readonly count: number };

/** Installs (or asks the status of) DuckDB through the workspace's daemon, which then uses it at once. */
async function throughDaemon(
  session: Session,
  verb: "install" | "status",
  onStep: (step: Step) => void,
): Promise<Status> {
  if (verb === "status") return session.call(sqlStatus, {});
  const onEvent = (event: EventEnvelope): void => {
    if (event.type === "sql.progress") onStep(event.data);
  };
  const subscription = await session
    .socket()
    .subscribeWorkspace({ onEvent, onGap: () => undefined, onError: () => undefined });
  try {
    return await session.call(sqlInstall, {});
  } finally {
    subscription.close();
  }
}

const Line = z.union([
  z.object({ progress: z.object({ step: z.string(), index: z.number(), count: z.number() }) }),
  z.object({
    status: z.object({
      installed: z.boolean(),
      version: z.string(),
      source: z.string(),
      folder: z.string(),
    }),
  }),
  z.object({
    error: z.object({
      name: z.string(),
      message: z.string(),
      data: z.record(z.string(), z.unknown()),
    }),
  }),
]);

/** The same, with no daemon running: the server's install in a process of its own, so no workspace is needed. */
async function onItsOwn(
  io: Io,
  verb: "install" | "status",
  onStep: (step: Step) => void,
): Promise<Status> {
  const entry = fileURLToPath(import.meta.resolve("@jsnb/server/sql-install"));
  const child = io.spawn(io.execPath, [entry, verb], {
    env: { ...io.env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let result: Status | JsnbError | undefined;
  const lines = createInterface({ input: child.stdout ?? Readable.from([]) });
  for await (const text of lines) {
    let parsed: z.infer<typeof Line> | undefined;
    try {
      parsed = Line.parse(JSON.parse(text));
    } catch {
      continue;
    }
    if ("progress" in parsed) onStep(parsed.progress);
    else if ("status" in parsed) result = parsed.status;
    else result = new JsnbError(parsed.error);
  }
  if (result === undefined)
    throw new JsnbError({ name: "SqlInstallFailed", message: "DuckDB's install stopped." });
  if (result instanceof JsnbError) throw result;
  return result;
}

/** Through the daemon when one runs for this folder's workspace, else on its own. */
async function sqlCall(
  io: Io,
  verb: "install" | "status",
  onStep: (step: Step) => void,
): Promise<Status> {
  if ((await markedWorkspace(io.cwd)) !== undefined) {
    try {
      return await withSession(io, { start: false, command: `sql ${verb}` }, (session) =>
        throughDaemon(session, verb, onStep),
      );
    } catch (error) {
      if (!(error instanceof DaemonNotRunning)) throw error;
    }
  }
  return onItsOwn(io, verb, onStep);
}

async function install(screen: Screen, io: Io): Promise<ExitCode> {
  const before = await sqlCall(io, "status", () => undefined);
  if (before.installed) {
    await screen.step(
      "ok",
      `DuckDB ${before.version} is installed already`,
      screen.path(before.folder),
    );
    return exitCodes.ok;
  }
  await screen.line(
    `DuckDB for SQL from the CLI and agents: ${about}, into ${screen.path(before.folder)}.`,
  );
  let bar: ReturnType<Screen["progress"]> | undefined;
  const onStep = (step: Step): void => {
    bar ??= screen.progress("Installing DuckDB", step.count, "steps");
    bar.update(step.step === "ready" ? step.count : step.index);
  };
  let after: Status;
  try {
    after = await sqlCall(io, "install", onStep);
  } catch (error) {
    await (bar ?? screen.progress("Installing DuckDB", 1, "steps")).end(
      "fail",
      "DuckDB was not installed",
    );
    throw error;
  }
  await (bar ?? screen.progress("Installing DuckDB", 1, "steps")).end(
    "ok",
    `Installed DuckDB ${after.version}`,
    screen.path(after.folder),
  );
  await removal(screen, io, after.folder);
  return exitCodes.ok;
}

/** How to take DuckDB out again. */
async function removal(screen: Screen, io: Io, folder: string): Promise<void> {
  await screen.line(
    `  ${screen.dim("SQL queries on outputs work from the CLI and agents now. To remove it:")}`,
  );
  await screen.command(
    `rm -rf ${shellWord(folder, io.env.HOME ?? "")}`,
    `(${productName} uninstall removes it too)`,
  );
}

/** The verb and the rest: `nimbo --json sql install` arrives as `sql --json install`, so the first non-flag word. */
function split(argv: readonly string[]): { verb: string | undefined; rest: readonly string[] } {
  const at = argv.findIndex((arg) => !arg.startsWith("-"));
  if (at === -1) return { verb: argv[0], rest: argv.slice(1) };
  return { verb: argv[at], rest: argv.filter((_arg, index) => index !== at) };
}

/** The registry's own `sql` commands and help, for --json, --help and every other verb. */
async function generated(
  verb: string | undefined,
  rest: readonly string[],
  io: Io,
): Promise<ExitCode> {
  const command = verb === undefined ? undefined : findCommand("sql", verb);
  if (command !== undefined) return runGenerated(command, rest, io);
  if (verb === undefined || verb === "--help" || verb === "-h") {
    await write(verb === undefined ? io.stderr : io.stdout, domainHelp("sql") ?? "");
    return verb === undefined ? exitCodes.usage : exitCodes.ok;
  }
  throw new InvalidArguments(
    { argument: verb, command: "sql" },
    `${productName} sql has no verb ${verb}.`,
  );
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const { verb, rest } = split(argv);
  const help = rest.some((arg) => ["--help", "-h"].includes(arg));
  // `sql status --json` with no daemon reads the status on its own, as `sql install --json` installs.
  if (verb === "status" && !help && rest.includes("--json")) {
    readShortcut("sql status", rest, {}, { min: 0, max: 0 });
    await write(io.stdout, `${JSON.stringify(await sqlCall(io, "status", () => undefined))}\n`);
    return exitCodes.ok;
  }
  const flagged = help || rest.includes("--json");
  if ((verb !== "status" && verb !== "install") || flagged) return generated(verb, rest, io);
  readShortcut(`sql ${verb}`, rest, {}, { min: 0, max: 0 });
  return withScreen(io, `sql ${verb}`, { yes: true }, async (screen) => {
    if (verb === "install") return install(screen, io);
    await showStatus(screen, await sqlCall(io, "status", () => undefined));
    return exitCodes.ok;
  });
}

export const sqlShortcut: Shortcut = {
  name: "sql",
  usage: "sql status|install",
  summary: "DuckDB for SQL from the CLI and agents: whether it is installed, and its install",
  help: domainHelp("sql") ?? "",
  run,
};
