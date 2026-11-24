// Tests the realm's composition: built-ins wired to the current store, the plumbing, the routes message, the notice
// for an error that no cell owns, and the reports of the process-hook check (over the stand-in emitter of
// fixtures/hookedEmitter.ts, a stub: the test process's own hooks stay Node's).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { silent, standIn } from "./fixtures/hookedEmitter.js";
import { defaultLimits } from "./ipc/messages.js";
import type { KernelMessage } from "./ipc/messages.js";
import type { HookedProcess } from "./processHooks.js";
import { captureProcessHooks } from "./processHooks.js";
import type { Realm, RealmDeps } from "./realm.js";
import { createRealm } from "./realm.js";

const store = { cell: "c_aaaaaa", execution: "x_aaaaaaaa" };
let workspace = "";
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** A realm over a temp workspace that records what it sends, logs and exits; stream flushes are prompt. */
function makeRealm(env?: string, hooked: HookedProcess = process) {
  workspace = mkdtempSync(join(tmpdir(), "nimbo-realm-"));
  if (env !== undefined) writeFileSync(join(workspace, ".env"), env);
  const messages: KernelMessage[] = [];
  const logs: string[] = [];
  const exits: number[] = [];
  const deps: RealmDeps = {
    config: {
      notebook: "test.jsnb",
      routeBase: "http://127.0.0.1:1/n/test",
      limits: defaultLimits(),
    },
    ...{
      workspace,
      processEnv: {},
      interrupted: () => false,
      load: (url) => import(url),
      clock: () => "2026-10-12T00:00:00.000Z",
    },
    send: (message) => messages.push(message),
    log: (_stream, text) => logs.push(text),
    schedule: (flush) => {
      flush();
    },
    hooks: captureProcessHooks(hooked),
    exit: (code) => {
      exits.push(code);
    },
  };
  const realm: Realm = createRealm(deps);
  const builtin = (name: string): unknown => Reflect.get(realm.scope.record, name);
  return { realm, messages, logs, exits, builtin };
}

describe("createRealm built-ins", () => {
  it("writes stream text to the sink under a store and to the kernel log without one", () => {
    const { realm, messages, logs, builtin } = makeRealm();
    const console = builtin("console") as Console;
    console.log("orphan");
    expect(realm.builtins.write("stdout", "also orphan")).toBe(false);
    realm.stores.run(store, () => {
      console.error("owned");
    });
    expect(messages).toEqual([
      {
        type: "output",
        execution: store.execution,
        output: { kind: "stream", stream: "stderr", text: "owned\n" },
      },
    ]);
    expect(logs).toEqual(["orphan\n"]);
  });

  it("exposes every v1 built-in and leaves display outputs with no store unsent", () => {
    const { realm, messages, builtin } = makeRealm();
    const names = ["console", "env", "display", "route", "routeUrl", "emit", "dispose", "require"];
    const all = [...names, "setTimeout", "setInterval", "setImmediate", "queueMicrotask"];
    expect(all.map((name) => typeof Reflect.get(realm.scope.record, name))).not.toContain(
      "undefined",
    );
    (builtin("display") as { html: (html: string) => void }).html("<i>");
    expect(messages).toEqual([]);
  });

  it("sends the route table whenever it changes", () => {
    const { realm, messages, builtin } = makeRealm();
    const route = builtin("route") as (spec: string, handler: () => string) => () => void;
    const dispose = realm.stores.run(store, () => route("GET /x", () => "x"));
    dispose();
    expect(messages.map((m) => m.type === "routes" && m.routes.length)).toEqual([1, 0]);
  });
});

describe("createRealm plumbing and errors", () => {
  it("registers exports and name creations only under a store", () => {
    const { realm, builtin } = makeRealm();
    const exportName = builtin("__export") as (name: string, from?: string) => void;
    exportName("outside");
    realm.scope.record.loose = 1;
    realm.stores.run(store, () => {
      exportName("inside", "local");
      realm.scope.record.owned = 2;
    });
    expect(realm.exports.list()).toEqual([{ name: "inside", cell: "c_aaaaaa" }]);
    expect([realm.names.get("loose"), realm.names.get("owned")]).toEqual([
      undefined,
      { definedBy: "c_aaaaaa", kind: "var" },
    ]);
  });

  it("logs an error no cell owns as a JSON notice, left to the daemon side to redact", () => {
    const { realm, logs } = makeRealm("TOKEN=abcdefgh123\n");
    realm.reportError(undefined, new Error("lost abcdefgh123"));
    const notice: unknown = JSON.parse(logs[0] ?? "");
    expect(notice).toMatchObject({
      level: "error",
      notebook: "test.jsnb",
      error: { message: "lost abcdefgh123" },
    });
  });
});

const notices = (logs: readonly string[]) => logs.map((line): unknown => JSON.parse(line));

describe("createRealm's process-hook check", () => {
  it("is nothing to wait for while both hooks are Node's own", () => {
    const { realm } = makeRealm(undefined, standIn());
    expect(realm.checkHooks(store)).toBeUndefined();
  });

  it("reports a hook that does not deliver with one notice and the error on the cell", async () => {
    const proc = standIn();
    const { realm, messages, logs, exits } = makeRealm(undefined, proc);
    proc.nextTick = silent;
    await realm.checkHooks(store);
    expect(messages).toMatchObject([
      {
        type: "output",
        execution: store.execution,
        output: { kind: "error", error: { name: "ProcessHookReplaced" } },
      },
    ]);
    expect(notices(logs)).toEqual([
      {
        level: "warn",
        msg: "process.nextTick was replaced by a function or an accessor that does not deliver, so the kernel put Node's own back",
        notebook: "test.jsnb",
        cell: store.cell,
      },
    ]);
    expect(exits).toEqual([]);
  });
});

describe("createRealm's process-hook check without a cell, or without a way back", () => {
  it("only logs the notice when no cell's code ran", async () => {
    const proc = standIn();
    const { realm, messages, logs } = makeRealm(undefined, proc);
    proc.emit = silent;
    await realm.checkHooks(undefined);
    expect([messages, logs.length]).toEqual([[], 1]);
    expect(logs[0]).toContain(
      "process.emit was replaced by a function or an accessor that does not deliver",
    );
  });

  it("ends the kernel at once when Node's own cannot be put back", async () => {
    const proc = standIn();
    const { realm, messages, logs, exits } = makeRealm(undefined, proc);
    Object.defineProperty(proc, "nextTick", {
      value: silent,
      writable: false,
      configurable: false,
    });
    await realm.checkHooks(store);
    expect([messages, exits, logs.length]).toEqual([[], [1], 1]);
    expect(notices(logs)[0]).toMatchObject({ level: "error" });
    expect(logs[0]).toContain("cannot be put back, so the kernel ends");
  });
});
