// startServer (02-architecture §7): one daemon for a workspace folder, in this process. It prepares `.jsnb/`, refuses
// to start beside a live daemon (a stale server.json is removed), listens on 127.0.0.1, writes server.json (0600) once
// the socket listens, and stops cleanly: notebooks closed, sockets and the listener closed, server.json removed.
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";

import { createDispatch } from "./commands/dispatch.js";
import { createCommandTable } from "./commands/table.js";
import type { EventBus } from "./events/bus.js";
import { createEventBus } from "./events/bus.js";
import { createFeedbackStore } from "./files/feedback/feedbackStore.js";
import type { Log } from "./events/log.js";
import { DaemonRunning, liveDaemon } from "./files/existingDaemon.js";
import { openDaemonLog } from "./files/logs/logger.js";
import { removeLeftovers } from "./files/notebooks/scan.js";
import { createDaemonRedactor } from "./files/secrets/redactor.js";
import { pageEndpoints } from "./endpoints.js";
import { createServerFile, readServerFile, removeServerFile } from "./files/serverFile.js";
import type { JsnbDir } from "./files/workspaceDir.js";
import { prepareJsnbDir, resolveWorkspace } from "./files/workspaceDir.js";
import type { DaemonHttp } from "./http/server.js";
import { startHttp } from "./http/server.js";
import type { FolderService } from "./notebook/workspace/folders.js";
import { createFeedbackNotes } from "./notebook/workspace/feedbackNotes.js";
import { createFolders } from "./notebook/workspace/folders.js";
import type { Workspace } from "./notebook/workspace/workspace.js";
import { openWorkspace } from "./notebook/workspace/workspace.js";
import type { ResolvedOptions, ServerOptions } from "./options.js";
import { resolveOptions } from "./options.js";
import { duckdbStatus, installDuckdb } from "./files/duckdb/duckdb.js";
import { serverVersion } from "./files/version.js";
import { watchRoot } from "./rootWatch.js";
import type { Stopper } from "./stopper.js";
import { createStopper } from "./stopper.js";

export type RunningServer = {
  readonly port: number;
  /** The bearer token of this start (32 random bytes, base64url). */
  readonly token: string;
  /** `http://127.0.0.1:<port>`. */
  readonly url: string;
  readonly startedAt: string;
  /** The workspace folder, resolved. */
  readonly workspace: string;
  /** The clean stop of `workspace.stop`; idempotent. */
  readonly stop: () => Promise<void>;
  /** Settles once the daemon has stopped, whoever asked. */
  readonly closed: Promise<void>;
};

type Parts = {
  readonly jsnb: JsnbDir;
  readonly log: Log;
  readonly closeLog: () => void;
  readonly workspace: Workspace;
  readonly folders: FolderService;
  readonly http: DaemonHttp;
  readonly own: { readonly pid: number; readonly startedAt: string };
};

/** The stop sequence; each step runs even when an earlier one failed, which is logged. */
async function shutdown(parts: Parts): Promise<void> {
  const steps: readonly (readonly [string, () => Promise<void>])[] = [
    ["close the notebooks", () => parts.workspace.close()],
    ["close the sockets and the listener", () => parts.http.close()],
    ["remove server.json", () => removeServerFile(parts.jsnb.serverFile, parts.own)],
  ];
  for (const [step, run] of steps) {
    await run().catch((error: unknown) => {
      parts.log.error({ err: error }, `the daemon could not ${step} while stopping`);
    });
  }
  parts.log.info({}, "the daemon stopped");
  parts.closeLog();
}

type Start = {
  readonly resolved: ResolvedOptions;
  readonly root: string;
  readonly jsnb: JsnbDir;
  readonly token: string;
  /** The page cookie's value: 32 random bytes of its own per start, never the token, never in server.json. */
  readonly pageKey: string;
  readonly startedAt: string;
  readonly log: Log;
  readonly closeLog: () => void;
  readonly onEnvWrite: () => void;
  readonly redact: (text: string) => string;
};

/** Open folder's service: this daemon's folder and how it starts another folder's daemon (its own entry and options). */
const foldersOf = (
  resolved: ResolvedOptions,
  at: { readonly root: string; readonly workspace: Workspace; readonly log: Log },
): FolderService =>
  createFolders({
    root: at.root,
    launch: {
      entry: resolved.daemonEntry,
      uiDir: resolved.uiDir,
      userConfigDir: resolved.userConfigDir,
      logLevel: resolved.logLevel,
    },
    notebooks: at.workspace.notebooks,
    now: resolved.now,
    log: at.log,
  });

/** The workspace of `start`, its events on `bus`, its routes' port read from `listening` once the socket listens. */
function workspaceOf(start: Start, bus: EventBus, listening: { port: number }): Promise<Workspace> {
  const { resolved, root, jsnb, startedAt, log } = start;
  const facts = { root, serverVersion, pid: process.pid, startedAt };
  return openWorkspace({
    ...{
      facts,
      jsnb,
      userConfigDir: resolved.userConfigDir,
      bus,
      log,
      onEnvWrite: start.onEnvWrite,
      redact: start.redact,
      pageCredentials: { token: start.token, pageKey: start.pageKey },
    },
    ...{
      ids: resolved.ids,
      now: resolved.now,
      port: () => listening.port,
      kernelEntry: resolved.kernelEntry,
      installTimeoutMs: resolved.installTimeoutMs,
      requestTimeoutMs: resolved.requestTimeoutMs,
      moveCheckMs: resolved.rootCheckMs,
    },
  });
}

/** The workspace, the command table and the HTTP server, wired to one stopper. */
async function assemble(start: Start, stopper: Stopper): Promise<Parts> {
  const { resolved, root, jsnb, token, pageKey, startedAt, log } = start;
  const bus = createEventBus(resolved.now);
  const listening = { port: 0 };
  const workspace = await workspaceOf(start, bus, listening);
  const requestStop = (): void => void stopper.stop();
  const duckdbService = { status: () => duckdbStatus(), install: installDuckdb };
  const folders = foldersOf(resolved, { root, workspace, log });
  const store = createFeedbackStore(jsnb.dir, serverVersion);
  const feedback = createFeedbackNotes(store);
  const dispatch = createDispatch(
    createCommandTable({ workspace, bus, folders, feedback, requestStop, sql: duckdbService }),
    log,
  );
  const { uiDir, routeTimeoutMs, bundleTimeoutMs } = resolved;
  const endpointOptions = { uiDir, routeTimeoutMs, bundleTimeoutMs, log, feedback: store };
  const pages = pageEndpoints(workspace, jsnb, endpointOptions);
  try {
    const http = await startHttp({ port: resolved.port, token, pageKey, dispatch, pages, log });
    listening.port = http.port;
    const own = { pid: process.pid, startedAt };
    return { jsnb, log, closeLog: start.closeLog, workspace, folders, http, own };
  } catch (error) {
    await workspace.close();
    throw error;
  }
}

/** Writes server.json once the socket listens; DaemonRunning when another daemon's file got there first. */
async function publish(start: Start, parts: Parts, stopper: Stopper): Promise<RunningServer> {
  const { port } = parts.http;
  // Home's recent folders note this one (a failure is logged, never the start's), before server.json says the daemon
  // is there: from then on a caller may signal it, and the process entry handles signals once the start returned.
  await parts.folders.rememberOwn();
  const content = {
    ...parts.own,
    port,
    token: start.token,
    version: serverVersion,
    root: start.root,
  };
  if (!(await createServerFile(start.jsnb.serverFile, content))) {
    await Promise.all([parts.http.close(), parts.workspace.close()]);
    const other = await readServerFile(start.jsnb.serverFile); // the winner's: read, never judged or removed here
    throw new DaemonRunning({
      workspace: start.root,
      pid: other?.pid ?? 0,
      port: other?.port ?? 0,
    });
  }
  const everyMs = start.resolved.rootCheckMs;
  const clearWatch = watchRoot({
    root: start.root,
    everyMs,
    log: parts.log,
    stop: () => stopper.stop(),
  });
  stopper.arm(() => {
    clearWatch();
    return shutdown(parts);
  });
  const url = `http://127.0.0.1:${String(port)}`;
  parts.log.info({ url, workspace: start.root }, "the daemon is listening");
  const { token, startedAt, root: workspace } = start;
  return { port, token, url, startedAt, workspace, stop: stopper.stop, closed: stopper.closed };
}

/** Starts a daemon for `options.workspace`; resolves once it listens and server.json is written. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const resolved = resolveOptions(options);
  const root = await resolveWorkspace(resolve(resolved.workspace));
  const jsnb = await prepareJsnbDir(root);
  const existing = await liveDaemon(jsnb.serverFile, root);
  if (existing)
    throw new DaemonRunning({ workspace: root, pid: existing.pid, port: existing.port });
  await removeLeftovers(root);
  const token = randomBytes(32).toString("base64url");
  const pageKey = randomBytes(32).toString("base64url");
  const redactor = createDaemonRedactor(join(root, ".env"), [token, pageKey]);
  const daemonLog = openDaemonLog({
    folder: jsnb.logs,
    level: resolved.logLevel,
    redact: redactor.redact,
    maxBytes: resolved.logMaxBytes,
    ...(resolved.logToStderr ? { echo: process.stderr } : {}),
  });
  // The monitor leaves Node's own crash and exit unchanged.
  const crashed = (error: Error, origin: string): void => {
    daemonLog.logger.fatal({ err: error, origin }, "the daemon crashed");
  };
  process.on("uncaughtExceptionMonitor", crashed);
  const closeLog = (): void => {
    process.off("uncaughtExceptionMonitor", crashed);
    daemonLog.close();
  };
  const start: Start = {
    ...{ resolved, root, jsnb, token, pageKey, startedAt: resolved.now().toISOString() },
    ...{ log: daemonLog.logger, closeLog, onEnvWrite: redactor.refresh },
    redact: redactor.redact,
  };
  const stopper = createStopper();
  try {
    return await publish(start, await assemble(start, stopper), stopper);
  } catch (error) {
    closeLog();
    throw error;
  }
}
