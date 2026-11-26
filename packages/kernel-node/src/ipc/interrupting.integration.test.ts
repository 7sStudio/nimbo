// Tests the daemon's interrupt sends over a real child and its real inspector session, through wrappers
// around that session. Counting the evaluates: an interrupt that carries a live execution is followed by a second call
// unless the kernel's hook refused it, so when a raw setImmediate callback of a cell that still runs spins (a context
// Node entered from JavaScript, which the hook refuses to stop), the interrupt settles with the refusal after its one
// evaluate and sends no second call. And the race of an evaluate that reaches the kernel while the one before it still
// has its termination pending, takes that termination and fails (V8 then cancels it): no real component loses it on
// demand, so a timing stub answers the first evaluate at once and the next one reaches the kernel right behind it.
// Several interrupts at once of a spinning cell (their coalesced evaluate takes it), and one interrupt of code that
// spins for a run already over while another run waits (the second call takes it): each round, the call that follows
// the failed evaluate stops the code and the next run answers.
import { writeFile } from "node:fs/promises";

import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { daemonContext, withLaunch } from "../fixtures/launchWorld.js";
import { cellBook } from "../fixtures/realmHarness.js";
import type { Cdp } from "./inspector.js";
import { requestInterrupt } from "./interrupting.js";
import { write } from "./kernelState.js";

/** A cell line that writes `what` and the round's number to the kernel log (fd 1), so each round waits for its own. */
const say = (what: string): string => `writeSync(1, \`${what} \${globalThis.rounds}\\n\`)`;

const book = cellBook({
  immediate: [
    'import { existsSync, writeSync } from "node:fs"',
    'globalThis.setImmediate(() => { writeSync(1, "spinning\\n"); while (!existsSync("release.flag")) {} })',
    "await new Promise(() => undefined)",
  ].join("\n"),
  spin: [
    'import { writeSync } from "node:fs"',
    "globalThis.rounds = (globalThis.rounds ?? 0) + 1",
    say("spinning"),
    "while (true) {}",
  ].join("\n"),
  detached: [
    'import { writeSync } from "node:fs"',
    "globalThis.rounds = (globalThis.rounds ?? 0) + 1",
    `void new Promise((r) => setTimeout(r, 1)).then(() => { ${say("spinning")}; while (true) {} })`, // tested behaviour
  ].join("\n"),
  waiting: "1 + 1",
  next: `import { writeSync } from "node:fs"\n${say("answered")}`,
});

beforeAll(() => {
  book.compile(compileCell);
});

/** `cdp`, recording the parameters of each Runtime.evaluate sent through it. */
function counting(cdp: Cdp) {
  const evaluated: unknown[] = [];
  const send: Cdp["send"] = (method, params) => {
    if (method === "Runtime.evaluate") evaluated.push(params);
    return cdp.send(method, params);
  };
  return { cdp: { ...cdp, send }, evaluated };
}

/** How many evaluates the kernel failed in a test's rounds: each one took the termination pending before it. */
type Lost = { count: number };

/**
 * Stub, for timing only: `cdp`, its first Runtime.evaluate sent to the kernel but answered at once (refusing nothing),
 * as when a real kernel's answer comes back before its inspector has finished dispatching. The evaluate the daemon
 * sends next so reaches the kernel right behind the first one, while that one's termination is pending; each later
 * evaluate the kernel fails is counted in `lost`.
 */
function answeredAtOnce(cdp: Cdp, lost: Lost): Cdp {
  let first = true;
  const send: Cdp["send"] = (method, params) => {
    const sent = cdp.send(method, params);
    if (method !== "Runtime.evaluate") return sent;
    if (!first) {
      // Counted here; the daemon handles the failure itself.
      void sent.catch(() => {
        lost.count += 1;
      });
      return sent;
    }
    first = false;
    void sent.catch(() => undefined); // its own answer is dropped: the stub gave one
    return Promise.resolve({ result: { type: "undefined" } });
  };
  return { ...cdp, send };
}

describe("an interrupt the kernel's hook refused", () => {
  it("settles with the refusal after one evaluate, and sends no second call for its live execution", async () => {
    await withLaunch(async ({ session: started, logged }, ws) => {
      const session = await started;
      const context = daemonContext(session, ws);
      const cell = book.cell("immediate");
      write(context, session, { type: "execute", ...cell });
      await logged((line) => line === "spinning");
      const { cdp, evaluated } = counting(session.cdp);
      expect(await requestInterrupt(context, cdp, [cell.execution])).toEqual({
        context: "Immediate",
        cell: cell.cell,
      });
      const hook = 'process[Symbol.for("jsnb.kernel.interrupt")]';
      expect(evaluated).toEqual([
        expect.objectContaining({ expression: `${hook}(["${cell.execution}"])` }),
      ]);
      await writeFile(ws.path("release.flag"), "");
    });
  });
});

/**
 * Rounds of each race: every round must stop the code. The stub makes the race the rule (lost in 60 of 60 rounds when
 * measured), and each test checks it was lost.
 */
const rounds = 10;

describe("interrupts at once of a spinning cell (stub: the first evaluate answered at once)", () => {
  it("stop it once their evaluate took the first one's termination, and the next run answers", async () => {
    await withLaunch(async ({ session: started, logged }, ws) => {
      const session = await started;
      const context = daemonContext(session, ws);
      const lost = { count: 0 };
      for (let round = 1; round <= rounds; round += 1) {
        const spin = book.cell("spin");
        write(context, session, { type: "execute", ...spin });
        await logged((line) => line === `spinning ${String(round)}`);
        const cdp = answeredAtOnce(session.cdp, lost);
        await Promise.all(
          [[spin.execution], [], []].map((ids) => requestInterrupt(context, cdp, ids)),
        );
        write(context, session, { type: "execute", ...book.cell("next") });
        await logged((line) => line === `answered ${String(round)}`);
      }
      expect(lost.count).toBeGreaterThan(0);
    });
  });
});

describe("an interrupt of code spinning for a run already over (stub: the first evaluate answered at once)", () => {
  it("stops it, a run waiting, once the second call took the first one's termination", async () => {
    await withLaunch(async ({ session: started, logged }, ws) => {
      const session = await started;
      const context = daemonContext(session, ws);
      const lost = { count: 0 };
      for (let round = 1; round <= rounds; round += 1) {
        write(context, session, { type: "execute", ...book.cell("detached") });
        await logged((line) => line === `spinning ${String(round)}`);
        const waiting = book.cell("waiting");
        write(context, session, { type: "execute", ...waiting });
        await requestInterrupt(context, answeredAtOnce(session.cdp, lost), [waiting.execution]);
        write(context, session, { type: "execute", ...book.cell("next") });
        await logged((line) => line === `answered ${String(round)}`);
      }
      expect(lost.count).toBeGreaterThan(0);
    });
  });
});
