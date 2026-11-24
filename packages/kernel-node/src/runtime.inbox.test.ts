// Tests the runtime's inbox (04-kernel §6) with turns the test runs by hand: one message per turn, the next turn
// scheduled before the message's microtask, the draining flag cleared only by a turn that finds the inbox empty, and
// no flag left standing when scheduling a turn fails (a stub: a scheduling that throws once stands for a termination
// landing between two statements, which a real termination would do to the test's own code); a `cancel` recorded as it
// arrives, so the inbox drops a request the daemon abandoned, while one already started runs on.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { KernelMessage } from "./ipc/messages.js";
import { defaultLimits } from "./ipc/messages.js";
import { captureProcessHooks } from "./processHooks.js";
import { createRuntime } from "./runtime.js";

let workspace = "";
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** A runtime whose turns wait in `turns`; `refuseNext` makes the next scheduling throw. */
function byHand() {
  workspace = mkdtempSync(join(tmpdir(), "nimbo-inbox-"));
  const turns: (() => void)[] = [];
  const sent: KernelMessage[] = [];
  let refuse = false;
  const runtime = createRuntime({
    config: { notebook: "t.jsnb", routeBase: "http://127.0.0.1:1/n/t", limits: defaultLimits() },
    ...{ workspace, processEnv: {}, interrupted: () => false, clock: () => "" },
    load: (url) => import(url),
    send: (message) => sent.push(message),
    log: () => undefined,
    schedule: (flush) => {
      queueMicrotask(flush);
    },
    defer: (turn) => {
      if (refuse) {
        refuse = false;
        throw new Error("stopped between two statements");
      }
      turns.push(turn);
    },
    end: () => undefined,
    hooks: captureProcessHooks(process),
    exit: (code) => {
      throw new Error(`the runtime ended the process with ${String(code)}, which no test expects`);
    },
  });
  const ids = () => sent.flatMap((message) => (message.type === "result" ? [message.id] : []));
  return { runtime, turns, ids, refuseNext: () => (refuse = true) };
}

const bindings = (id: number) => ({ type: "bindings", id });

describe("the runtime's inbox", () => {
  it("dispatches one message per turn and clears the flag only by a turn that finds the inbox empty", async () => {
    const { runtime, turns, ids } = byHand();
    runtime.receive(bindings(1));
    runtime.receive(bindings(2));
    expect(turns).toHaveLength(1);
    turns[0]?.();
    turns[1]?.();
    await Promise.resolve();
    expect([ids(), turns.length]).toEqual([[1, 2], 3]);
    turns[2]?.();
    runtime.receive(bindings(3));
    turns[3]?.();
    await Promise.resolve();
    expect([ids(), turns.length]).toEqual([[1, 2, 3], 5]);
  });

  it("leaves no flag standing without a turn when scheduling the turn fails", async () => {
    const { runtime, turns, ids, refuseNext } = byHand();
    refuseNext();
    expect(() => {
      runtime.receive(bindings(1));
    }).toThrow("stopped between two statements");
    runtime.receive(bindings(2));
    turns[0]?.();
    turns[1]?.();
    await Promise.resolve();
    expect(ids()).toEqual([1, 2]);
  });
});

describe("the runtime's inbox and the requests the daemon abandoned", () => {
  it("drops a request it reaches with a cancelled id, sending nothing, and answers the others", async () => {
    const { runtime, turns, ids } = byHand();
    runtime.receive(bindings(1));
    runtime.receive(bindings(2));
    runtime.receive({ type: "cancel", ids: [1, 7] });
    expect(turns).toHaveLength(1);
    turns[0]?.();
    turns[1]?.();
    await Promise.resolve();
    expect(ids()).toEqual([2]);
  });

  it("lets a request already started run on: a cancel only stops one not started yet", async () => {
    const { runtime, turns, ids } = byHand();
    runtime.receive(bindings(1));
    turns[0]?.();
    runtime.receive({ type: "cancel", ids: [1] });
    await Promise.resolve();
    expect(ids()).toEqual([1]);
  });
});
