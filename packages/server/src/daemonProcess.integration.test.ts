// runDaemon in-process, as src/main.ts runs it against the real process: the listening line once
// it listens, the clean stop on each signal with exit code 0 and server.json gone, 1 with one JSON line when the start
// fails, 2 for arguments it cannot use. A stand-in takes the place of `process` (its cwd, streams and signals); the
// daemon is the real one. The built dist/main.js runs as a process in daemonProcess.built.integration.test.ts.
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { runDaemon } from "./daemonProcess.js";

type Signal = "SIGINT" | "SIGTERM" | "SIGHUP";

/** A stand-in for `process`: its cwd, its signals, what it wrote, and a wait for its first stdout line. */
function standIn(cwd: string) {
  const signals = new EventEmitter();
  const out: string[] = [];
  const err: string[] = [];
  let wrote = (): void => undefined;
  const firstLine = new Promise<void>((resolve) => {
    wrote = resolve;
  });
  const writer = (into: string[], then: () => void) => ({
    write: (text: string) => {
      into.push(text);
      then();
      return true;
    },
  });
  return {
    cwd: () => cwd,
    once: (signal: Signal, listener: () => void) => signals.once(signal, listener),
    stdout: writer(out, () => {
      wrote();
    }),
    stderr: writer(err, () => undefined),
    emit: (signal: Signal) => signals.emit(signal),
    firstLine,
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

describe("runDaemon", () => {
  it("prints its listening line and stops cleanly on each signal with exit code 0", async () => {
    await withWorkspace(async (ws) => {
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        const host = standIn(ws.dir);
        const exit = runDaemon(["--user-config", ws.path(".user")], host);
        await host.firstLine;
        expect(host.out()).toMatch(/^\{"event":"listening","url":"http:\/\/127\.0\.0\.1:\d+",/);
        expect(existsSync(ws.path(".jsnb/server.json"))).toBe(true);
        host.emit(signal);
        expect(await exit).toBe(0);
        expect(existsSync(ws.path(".jsnb/server.json"))).toBe(false);
      }
    });
  });

  it("stops cleanly on a signal that came while it was starting", async () => {
    await withWorkspace(async (ws) => {
      const host = standIn(ws.dir);
      const exit = runDaemon(["--user-config", ws.path(".user")], host);
      host.emit("SIGTERM");
      expect(await exit).toBe(0);
      expect(existsSync(ws.path(".jsnb/server.json"))).toBe(false);
    });
  });

  it("exits 2 for arguments it cannot use and 1 with one JSON line when the start fails", async () => {
    await withWorkspace(async (ws) => {
      const bad = standIn(ws.dir);
      expect(await runDaemon(["--port", "nope"], bad)).toBe(2);
      expect(JSON.parse(bad.err())).toMatchObject({ name: "InvalidArguments" });
      const missing = standIn(ws.dir);
      expect(await runDaemon(["--workspace", ws.path("missing")], missing)).toBe(1);
      expect(JSON.parse(missing.err())).toMatchObject({
        name: "WorkspaceMissing",
        data: { path: ws.path("missing") },
      });
      expect(missing.out()).toBe("");
    });
  });
});
