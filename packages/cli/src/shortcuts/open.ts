// `nimbo open [path] [--no-browser] [--background]` (03-api §8, §7.1): the notebook opened (created first when there is
// no such file) and its page `/ui/<name>?token=…` handed to the browser opener; with no path and no notebook the -n
// default settles on, the Home page `/ui/?token=…` instead. With no daemon running, the daemon runs in the
// terminal's foreground until Ctrl-C (daemon/foreground.ts), as a Jupyter server does; one already running is used
// and the command returns; --background starts it detached and returns. The token-bearing URL is printed only with
// --no-browser or when no opener ran, and the opener's command never. Bare `nimbo` on a terminal
// opens the Home page through the same path.
import { ApiError, notebookCreate, notebookOpen, notebookPageName } from "@jsnb/core";

import { runForeground } from "../daemon/foreground.js";
import { defaultNotebookOrNone, notebookArgument, presetNotebook } from "../daemon/notebook.js";
import type { Session } from "../daemon/session.js";
import { openSession } from "../daemon/session.js";
import { findWorkspace } from "../daemon/workspace.js";
import { DaemonForeign, DaemonNotRunning } from "../errors/daemon.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import { platformOpener } from "../io/opener.js";
import type { Shortcut } from "./shortcut.js";
import { readShortcut, withSession } from "./shortcut.js";

/** notebook.open, or notebook.create when the file is not there (NOTEBOOK_NOT_FOUND without `closed`). */
async function openOrCreate(
  session: Session,
  path: string,
): Promise<{ readonly created: boolean }> {
  try {
    await session.call(notebookOpen, { path });
    return { created: false };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 1001 || error.data.closed === true)
      throw error;
    await session.call(notebookCreate, { path });
    return { created: true };
  }
}

const help = `nimbo open [path] [--no-browser] [--background]: open a notebook, or the Home page, in the browser

When no daemon runs for the workspace, runs it in this terminal until Ctrl-C, which stops it cleanly (notebooks
saved), its log on stderr one line per event (NIMBO_LOG=debug for more); when one already runs (another terminal, an agent's command), uses it and returns. Creates the notebook when
the file does not exist, opens it and hands its page to the browser. path is the notebook's path from the workspace root, as -n takes it, whatever the working
folder (an absolute path inside the workspace works too); without it, the notebook -n would default to (NIMBO_NOTEBOOK,
the only open notebook, the only .jsnb file); when none of them names one, the Home page, which lists the workspace's
notebooks and creates, opens, renames and deletes them.

Flags:
  --no-browser   print the page's address (it carries the daemon's token) instead of opening it
  --background   start the daemon detached and return (nimbo stop stops it), for scripts and agents
  --json         print { path, home, created, started, browser } (and url when it was printed) as JSON; path is
                 null for the Home page
`;

/** The path named, from the workspace root as -n's; outside the workspace exit 2. */
const refOf = async (io: Io, path: string | undefined): Promise<string | undefined> =>
  path === undefined
    ? undefined
    : notebookArgument(await findWorkspace(io.cwd), path, { argument: "<path>", command: "open" });

type Opened = {
  /** The notebook opened; undefined for the Home page. */
  readonly path: string | undefined;
  readonly created: boolean;
  readonly url: string;
  /** False with --no-browser, or when no opener ran. */
  readonly browser: boolean;
  readonly asked: boolean;
};

/** Where the daemon runs: this terminal's foreground, already somewhere else, or started detached (--background). */
type Mode = "foreground" | "running" | "background";

const afterwards: Readonly<Record<Mode, string>> = {
  foreground: "Press Ctrl+C to stop.\n",
  running:
    "It already runs in another terminal or in the background; Ctrl+C there or nimbo stop stops it.\n",
  background: "The app keeps running in the background; nimbo stop stops it.\n",
};

/** What `nimbo open` reports: two lines on stderr, and the address on stdout only when no browser got it. */
async function report(
  io: Io,
  session: Session,
  opened: Opened,
  how: { readonly mode: Mode; readonly json: boolean },
): Promise<void> {
  const asJson = how.json;
  const { path, created, url, browser } = opened;
  if (asJson) {
    const json = {
      path: path ?? null,
      home: path === undefined,
      created,
      started: how.mode !== "running",
      browser,
      ...(browser ? {} : { url }),
    };
    await write(io.stdout, `${JSON.stringify(json)}\n`);
    return;
  }
  const host = new URL(session.daemon.url).host;
  const daemon = `${how.mode === "running" ? "Daemon" : "Started the daemon"} for ${session.workspace} on ${host}`;
  const page = path ?? "the Home page";
  const what = `${created ? "created and opened" : "opened"} ${page}${browser ? " in the browser" : ""}`;
  await write(io.stderr, `${daemon} · ${what}\n`);
  await write(io.stderr, afterwards[how.mode]);
  if (browser) return;
  if (opened.asked)
    await write(
      io.stderr,
      "The browser did not open (no opener was found, or it failed); open this address:\n",
    );
  await write(io.stdout, `${url}\n`);
}

/** The page of `path`, opened (created first when missing), or the Home page; its address carries the token. */
async function pageOf(session: Session, path: string | undefined) {
  const token = encodeURIComponent(session.daemon.token);
  if (path === undefined)
    return { created: false, url: `${session.daemon.url}/ui/?token=${token}` };
  const { created } = await openOrCreate(session, path);
  return { created, url: `${session.daemon.url}/ui/${notebookPageName(path)}?token=${token}` };
}

/** What to open: the notebook the path or the -n default names, or the Home page whatever the default. */
type Target =
  { readonly home: true } | { readonly home: false; readonly given: string | undefined };

type Asked = { readonly asked: boolean; readonly json: boolean };

/** Opens the target's page in the browser through `session` and reports it. */
async function showPage(
  io: Io,
  session: Session,
  target: Target,
  options: Asked & { readonly mode: Mode },
) {
  const path = target.home ? undefined : (target.given ?? (await defaultNotebookOrNone(session)));
  const { created, url } = await pageOf(session, path);
  const opener = io.openUrl ?? platformOpener(io.platform, io.spawn);
  const browser = options.asked && (await opener(url));
  const opened = { path, created, url, browser, asked: options.asked };
  await report(io, session, opened, { mode: options.mode, json: options.json });
}

/** The workspace's own daemon when one already runs; undefined when none does (or another folder's answers). */
async function runningSession(io: Io): Promise<Session | undefined> {
  try {
    return await openSession(io, { start: false, command: "open" });
  } catch (error) {
    if (error instanceof DaemonNotRunning || error instanceof DaemonForeign) return undefined;
    throw error;
  }
}

/** The page through the daemon already running, or one started detached (--background); the command returns. */
function openReturning(io: Io, target: Target, options: Asked, mode: Mode): Promise<ExitCode> {
  return withSession(io, { start: mode === "background", command: "open" }, async (session) => {
    await showPage(io, session, target, { ...options, mode });
    return exitCodes.ok;
  });
}

/**
 * The page opened with the daemon in this terminal's foreground once it serves; Ctrl-C stops it (notebooks saved), a
 * second one ends it at once. A daemon already running is used instead, and the command returns.
 */
async function openPage(
  io: Io,
  target: Target,
  options: Asked & { readonly background: boolean },
): Promise<ExitCode> {
  if (options.background) return openReturning(io, target, options, "background");
  const running = await runningSession(io);
  if (running !== undefined) {
    running.close();
    return openReturning(io, target, options, "running");
  }
  const stop = { asked: false };
  const code = await runForeground(io, await findWorkspace(io.cwd), {
    command: "open",
    json: options.json,
    echoLog: false,
    listening: () =>
      withSession(io, { start: false, command: "open" }, (session) =>
        showPage(io, session, target, { ...options, mode: "foreground" }),
      ),
    stopping: () => {
      if (stop.asked) return;
      stop.asked = true;
      io.stderr.write("\nStopping: saving the notebooks…\n");
    },
  });
  if (stop.asked && code === exitCodes.ok) await write(io.stderr, "Stopped.\n");
  return code;
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const flags = { browser: { type: "boolean" }, background: { type: "boolean" } } as const;
  const args = readShortcut("open", argv, flags, { min: 0, max: 1 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const given =
    (await refOf(io, args.positionals[0])) ?? (await presetNotebook(io, undefined, "open"));
  return openPage(
    io,
    { home: false, given },
    {
      asked: args.values.browser !== false,
      json: args.json,
      background: args.values.background === true,
    },
  );
}

/**
 * Bare `nimbo` typed on a terminal (03-api §8): the Home page in the browser, the daemon started when none runs,
 * whatever notebook `nimbo open` would default to; a person at a prompt means "show me my notebooks".
 */
export const openHome = (io: Io): Promise<ExitCode> =>
  openPage(io, { home: true }, { asked: true, json: false, background: false });

export const openShortcut: Shortcut = {
  name: "open",
  usage: "open [path] [--no-browser] [--background]",
  summary:
    "open the notebook (created if needed) or the Home page in the browser; the daemon runs here until Ctrl+C",
  help,
  run,
};
