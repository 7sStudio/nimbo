// startServer: one daemon for a workspace folder, in this process. It prepares `.jsnb/`, refuses
// to start beside a live daemon (a stale server.json is removed), listens on 127.0.0.1, writes server.json (0600) once
// the socket listens, and stops cleanly: notebooks closed, sockets and the listener closed, server.json removed.
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";

import { createDispatch } from "./commands/dispatch.js";
import { createCommandTable } from "./commands/table.js";
import { createEventBus } from "./events/bus.js";
import { createFeedbackStore } from "./files/feedback/feedbackStore.js";
import { DaemonRunning, liveDaemon } from "./files/existingDaemon.js";
import { openDaemonLog } from "./files/logs/logger.js";
import { removeLeftovers } from "./files/notebooks/scan.js";
import { createDaemonRedactor } from "./files/secrets/redactor.js";
import { pageEndpoints } from "./endpoints.js";
import { createServerFile, readServerFile, removeServerFile } from "./files/serverFile.js";
import { prepareJsnbDir, resolveWorkspace } from "./files/workspaceDir.js";
import { startHttp } from "./http/server.js";
import { listExamples, trackTutorial } from "./notebook/workspace/examples.js";
import { createFeedbackNotes } from "./notebook/workspace/feedbackNotes.js";
import { createFolders } from "./notebook/workspace/folders.js";
import { openWorkspace } from "./notebook/workspace/workspace.js";
import type { ServerOptions } from "./options.js";
import { resolveOptions } from "./options.js";
import { duckdbStatus, installDuckdb } from "./files/duckdb/duckdb.js";
import { serverVersion } from "./files/version.js";
import { watchRoot } from "./rootWatch.js";
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
  // the page cookie's value: 32 random bytes of its own per start, never the token, never in server.json
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
  const startedAt = resolved.now().toISOString();
  const log = daemonLog.logger;
  const stopper = createStopper();
  try {
    // the workspace, the command table and the HTTP server, wired to one stopper
    const bus = createEventBus(resolved.now);
    const listening = { port: 0 }; // the routes' port, read once the socket listens
    const workspace = await openWorkspace({
      facts: { root, serverVersion, pid: process.pid, startedAt },
      jsnb,
      userConfigDir: resolved.userConfigDir,
      bus,
      log,
      onEnvWrite: redactor.refresh,
      redact: redactor.redact,
      pageCredentials: { token, pageKey },
      ids: resolved.ids,
      now: resolved.now,
      port: () => listening.port,
      kernelEntry: resolved.kernelEntry,
      installTimeoutMs: resolved.installTimeoutMs,
      requestTimeoutMs: resolved.requestTimeoutMs,
      moveCheckMs: resolved.rootCheckMs,
    });
    const requestStop = (): void => void stopper.stop();
    const duckdbService = { status: () => duckdbStatus(), install: installDuckdb };
    // Open folder's service: this daemon's folder and how it starts another folder's daemon (its own entry and options)
    const folders = createFolders({
      root,
      launch: {
        entry: resolved.daemonEntry,
        uiDir: resolved.uiDir,
        userConfigDir: resolved.userConfigDir,
        logLevel: resolved.logLevel,
      },
      notebooks: workspace.notebooks,
      now: resolved.now,
      log,
    });
    const store = createFeedbackStore(jsnb.dir, serverVersion);
    const feedback = createFeedbackNotes(store);
    const tutorial = trackTutorial({
      dir: jsnb.dir,
      listen: bus.listen,
      lessons: async () => (await listExamples()).filter((each) => each.kind === "tutorial"),
      warn: (message, error) => {
        log.warn({ err: error }, message);
      },
    });
    const services = { workspace, bus, folders, feedback, tutorial, requestStop };
    const dispatch = createDispatch(createCommandTable({ ...services, sql: duckdbService }), log);
    const { uiDir, routeTimeoutMs, bundleTimeoutMs } = resolved;
    const endpointOptions = { uiDir, routeTimeoutMs, bundleTimeoutMs, log, feedback: store };
    const pages = pageEndpoints(workspace, jsnb, endpointOptions);
    const http = await startHttp({
      port: resolved.port,
      token,
      pageKey,
      dispatch,
      pages,
      log,
    }).catch(async (error: unknown) => {
      await Promise.all([workspace.close(), tutorial.close()]);
      throw error;
    });
    listening.port = http.port;
    const own = { pid: process.pid, startedAt };

    // server.json once the socket listens; DaemonRunning when another daemon's file got there first
    const { port } = http;
    // Home's recent folders note this one (a failure is logged, never the start's), before server.json says the daemon
    // is there: from then on a caller may signal it.
    await folders.rememberOwn();
    const content = { ...own, port, token, version: serverVersion, root };
    if (!(await createServerFile(jsnb.serverFile, content))) {
      await Promise.all([http.close(), workspace.close(), tutorial.close()]);
      const other = await readServerFile(jsnb.serverFile); // the winner's: read, never judged or removed here
      throw new DaemonRunning({ workspace: root, pid: other?.pid ?? 0, port: other?.port ?? 0 });
    }
    const clearWatch = watchRoot({
      root,
      everyMs: resolved.rootCheckMs,
      log,
      stop: () => stopper.stop(),
    });
    // the stop sequence; each step runs even when an earlier one failed, which is logged
    const shutdown = async (): Promise<void> => {
      const steps: readonly (readonly [string, () => Promise<void>])[] = [
        ["close the notebooks", () => workspace.close()],
        ["write the tutorial's progress", () => tutorial.close()],
        ["close the sockets and the listener", () => http.close()],
        ["remove server.json", () => removeServerFile(jsnb.serverFile, own)],
      ];
      for (const [step, run] of steps) {
        await run().catch((error: unknown) => {
          log.error({ err: error }, `the daemon could not ${step} while stopping`);
        });
      }
      log.info({}, "the daemon stopped");
      closeLog();
    };
    stopper.arm(() => {
      clearWatch();
      return shutdown();
    });
    const url = `http://127.0.0.1:${String(port)}`;
    log.info({ url, workspace: root }, "the daemon is listening");
    return {
      port,
      token,
      url,
      startedAt,
      workspace: root,
      stop: stopper.stop,
      closed: stopper.closed,
    };
  } catch (error) {
    closeLog();
    throw error;
  }
}
