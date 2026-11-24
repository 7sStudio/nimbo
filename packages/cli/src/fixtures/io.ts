// A test's world for `run(argv, io)`: captured stdout and stderr, stdin from a string, an environment of the test's own
// (its user settings inside the workspace), signals the test sends, and the effects it chooses: the real spawn by
// default, and a browser opener that records the URL it was handed and opens nothing.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

import type { Io, Opener, SignalName, Spawn } from "../io/io.js";

export type TestIo = Io & {
  readonly out: () => string;
  readonly err: () => string;
  /** Settles once stdout's text so far satisfies `seen`: a test waits for what the command writes, never for time. */
  readonly untilOut: (seen: (text: string) => boolean) => Promise<string>;
  readonly untilErr: (seen: (text: string) => boolean) => Promise<string>;
  /** Sends a signal to the command, as a terminal's Ctrl-C would. */
  readonly signal: (name: SignalName) => void;
  /** The URLs handed to the browser opener. */
  readonly opened: readonly string[];
};

export type TestIoOptions = {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdin?: string;
  readonly isTTY?: boolean;
  readonly spawn?: Spawn;
  /** The recording opener's answer: true for a browser that opened (the default), false for none. No test opens one. */
  readonly opener?: boolean;
  readonly platform?: NodeJS.Platform;
  /** Whether stdout is a terminal (the default: not one, as in a pipe). */
  readonly outputIsTTY?: boolean;
  /** Whether stderr is a terminal (the default: not one). */
  readonly errorIsTTY?: boolean;
  /** The wait for an answer from server.json's port (the default: production's 2 s). */
  readonly daemonProbeMs?: number;
  /** The wait before retrying a start the daemon of a moved folder refused (the default: production's 3 s). */
  readonly movedRetryWait?: () => Promise<void>;
};

type Collector = {
  readonly stream: Writable;
  readonly text: () => string;
  readonly until: (seen: (text: string) => boolean) => Promise<string>;
};

const collector = (): Collector => {
  const chunks: string[] = [];
  const written = new EventEmitter();
  const text = (): string => chunks.join("");
  const stream = new Writable({
    write: (chunk: Buffer | string, _encoding, done) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      written.emit("write");
      done();
    },
  });
  const until = (seen: (text: string) => boolean): Promise<string> =>
    new Promise((resolve) => {
      const check = (): void => {
        if (!seen(text())) return;
        written.off("write", check);
        resolve(text());
      };
      written.on("write", check);
      check();
    });
  return { stream, text, until };
};

/** The environment a test's CLI sees: PATH and HOME for the processes it starts, user settings under `cwd`. */
const testEnv = (cwd: string): Record<string, string | undefined> => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: `${cwd}/.user-config`,
});

/** An Io over strings and recorders. */
export function testIo(options: TestIoOptions): TestIo {
  const out = collector();
  const err = collector();
  const signals = new EventEmitter();
  const opened: string[] = [];
  const recordingOpener: Opener = (url) => {
    opened.push(url);
    return Promise.resolve(options.opener !== false);
  };
  return {
    stdin: Readable.from(options.stdin === undefined ? [] : [options.stdin]),
    stdout: out.stream,
    stderr: err.stream,
    env: options.env ?? testEnv(options.cwd),
    cwd: options.cwd,
    isTTY: options.isTTY ?? false,
    ...(options.outputIsTTY === undefined ? {} : { outputIsTTY: options.outputIsTTY }),
    ...(options.errorIsTTY === undefined ? {} : { errorIsTTY: options.errorIsTTY }),
    ...(options.daemonProbeMs === undefined ? {} : { daemonProbeMs: options.daemonProbeMs }),
    ...(options.movedRetryWait === undefined ? {} : { movedRetryWait: options.movedRetryWait }),
    platform: options.platform ?? process.platform,
    execPath: process.execPath,
    spawn: options.spawn ?? spawn,
    openUrl: recordingOpener,
    onSignal: (name, listener) => {
      signals.on(name, listener);
      return () => signals.off(name, listener);
    },
    now: () => new Date("2026-11-01T12:00:00.000Z"),
    out: out.text,
    err: err.text,
    untilOut: out.until,
    untilErr: err.until,
    signal: (name) => signals.emit(name),
    opened,
  };
}
