// The world the MCP server runs against: its streams, environment and working folder, and the effects a test injects
// (spawning the daemon, the waits of its discovery), so the server runs in-process against a real daemon; and the codes
// of a stream whose reader went away, which end the server quietly.
import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { Readable, Writable } from "node:stream";

/** Starts a process: the daemon's entry. */
export type Spawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export type World = {
  /** The MCP client's messages, one JSON-RPC message per line. */
  readonly stdin: Readable;
  /** The answers to the MCP client, and nothing else. */
  readonly stdout: Writable;
  /** The server's own lines: a start waiting out an old daemon, a failure that is none of nimbo's. */
  readonly stderr: Writable;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The working folder, read at each call (WorkingFolderGone when it was deleted). */
  readonly cwd: () => string;
  /** The Node that runs the MCP server, which runs the daemon's entry too. */
  readonly execPath: string;
  readonly spawn: Spawn;
  /** How long the daemon server.json names may take to answer before it counts as none (2 s, as the server's own). */
  readonly daemonProbeMs?: number;
  /**
   * The wait before the one retry of a start that met the daemon of a moved folder, which stops by itself once its root
   * check sees the folder gone (3 s by default); a test waits on that daemon's stop instead.
   */
  readonly movedRetryWait?: () => Promise<void>;
};

/**
 * The codes of a stream whose reader is gone or that is closed already: EPIPE; ECANCELED (Node cancels a write in
 * flight to a child's stdin as it handles that child's exit); ENOTCONN (`stdio: "pipe"` is a socket pair, whose closing
 * peer can fail a write so under load); the stream's own when it is destroyed or ended; ECONNRESET.
 */
const goneCodes = new Set([
  "EPIPE",
  "ECANCELED",
  "ENOTCONN",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END",
  "ECONNRESET",
]);

/** Whether `error` says the stream's reader went away (the agent exited). */
export const readerGone = (error: unknown): boolean =>
  error instanceof Error && goneCodes.has(String(Reflect.get(error, "code") ?? ""));

/** What each request the MCP server answers reads: its world, the MCP client's name (03-api §9) and its signal. */
export type RequestContext = {
  readonly world: World;
  /** The MCP client's name from its `initialize`, once it said it; none before or when it gave none. */
  readonly agent: () => string | undefined;
  /** Aborted when the MCP client cancels the request (or goes): the call to the daemon stops waiting (08 §5). */
  readonly signal: AbortSignal;
  /** The most bytes a result's whole frame may carry. */
  readonly resultLimit: number;
};
