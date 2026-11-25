// A fake kernel process for child.ts's tests: an emitter for the listeners, stdout, stderr, IPC and process.kill that
// record what the kernel does (a kill signals nothing real: the fake pid names no process of the test's), over a fresh
// workspace with the daemon's loader and a .env, removed when the test finishes.
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { onTestFinished } from "vitest";

import type { KernelProcess } from "../child.js";
import { defaultLimits } from "../ipc/messages.js";

export type Sent = { readonly type: string; readonly [key: string]: unknown };

/** The child config the fake process passes as argv[2] by default. */
const config = {
  notebook: "test.jsnb",
  routeBase: "http://127.0.0.1:1/n/test",
  limits: defaultLimits(),
};

/** The tests' warm-up: Node's lazy globals are not what they measure. */
export const noWarmUp = (): Promise<void> => Promise.resolve();

type FakeOptions = {
  /** argv[2]; null leaves it out. */
  readonly argv2?: string | null;
  /** False makes a process without an IPC channel (no `send`). */
  readonly withIpc?: boolean;
  /** True makes every send's callback report a closed channel. */
  readonly refuse?: boolean;
  /** process.platform; "darwin" by default. */
  readonly platform?: string;
  /** True makes a kill of a process group throw, as for a process that leads none. */
  readonly groupless?: boolean;
};

const isSent = (message: unknown): message is Sent =>
  typeof message === "object" &&
  message !== null &&
  typeof Reflect.get(message, "type") === "string";

/** A workspace with the daemon's loader and a .env, removed when the test finishes. */
function prepareWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "nimbo-child-"));
  mkdirSync(join(workspace, ".jsnb"));
  writeFileSync(join(workspace, ".jsnb", "loader.mjs"), "export const load = (s) => import(s);\n");
  writeFileSync(join(workspace, ".env"), "FROM_ENV=loaded\n");
  onTestFinished(() => {
    rmSync(workspace, { recursive: true, force: true });
  });
  return workspace;
}

const recordingStream = (into: string[]) => ({
  write: (chunk: string | Uint8Array) => into.push(String(chunk)) > 0,
});

/** Resolves once `ready` holds, checked again whenever `changed` emits. */
const waitOn =
  (changed: EventEmitter) =>
  (ready: () => boolean): Promise<void> =>
    new Promise((resolve) => {
      const check = (): void => {
        if (!ready()) return;
        changed.off("change", check);
        resolve();
      };
      changed.on("change", check);
      check();
    });

/** process.kill recorded in `kills`; a group's kill throws when `groupless`, as for a process that leads no group. */
const recordingKill =
  (kills: (readonly [number, string])[], groupless: boolean) =>
  (pid: number, signal: string): true => {
    kills.push([pid, signal]);
    if (groupless && pid < 0) throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    return true;
  };

/** A fake process whose listeners are an emitter and whose streams, sends, kills and exits are recorded. */
export function fakeProcess(options: FakeOptions = {}) {
  const { argv2 = JSON.stringify(config), withIpc = true, refuse = false } = options;
  const { platform = "darwin", groupless = false } = options;
  const workspace = prepareWorkspace();
  const events = new EventEmitter();
  const changed = new EventEmitter();
  const record = { sent: new Array<Sent>(), out: new Array<string>(), err: new Array<string>() };
  const exits = new Array<number | undefined>();
  const kills = new Array<readonly [number, string]>();
  const send = (message: unknown, callback?: (error: Error | null) => void): boolean => {
    if (isSent(message)) record.sent.push(message);
    changed.emit("change");
    callback?.(refuse ? new Error("channel closed") : null);
    return true;
  };
  const proc: KernelProcess = {
    argv: ["node", "main.js", ...(argv2 === null ? [] : [argv2])],
    env: {},
    pid: 4242,
    cwd: () => workspace,
    stdout: recordingStream(record.out),
    stderr: recordingStream(record.err),
    ...(withIpc ? { send } : {}),
    platform,
    kill: recordingKill(kills, groupless),
    on: (event, listener) => events.on(event, listener),
    prependListener: (event, listener) => events.prependListener(event, listener),
    removeListener: (event, listener) => events.removeListener(event, listener),
    exit: (code) => {
      exits.push(code);
      changed.emit("change");
    },
  };
  return { proc, events, record: { ...record, exits, kills }, when: waitOn(changed) };
}
