// Tests a NodeKernel's state on failures no real child or inspector produces on demand, over the stub child and CDP
// session of fixtures/kernelContext.ts, each named as a stub: a send the child refuses while its session lives (a
// closed IPC channel), an inspector call that fails, and an interrupt whose evaluate fails while the kernel lives,
// which still moves on to the interrupts asked for meanwhile, then to the second call, `again`, that follows an
// evaluate of live executions, and then releases the held sends; a second call that fails (it reached the kernel
// while the first one's termination was pending and took it), sent again five times at most; the same lost race for
// a first evaluate and for the evaluate of interrupts asked for meanwhile, each followed by a second call though it
// carries no execution, and nothing more when every evaluate answered; and a refusal on the second call, which the
// real kernel gives only when a raw callback of the interrupted cell starts between the two calls, settling the
// interrupt, and the interrupts queued behind an evaluate settled when the kernel is gone by its answer. Everything
// else the state does is tested through the real child (nodeKernel*, executions, interrupt, interrupting,
// interruptContexts, kernelRequests and requestArguments integration tests).
import { describe, expect, it } from "vitest";

import { world } from "../fixtures/kernelContext.js";
import { InspectorFailed } from "./errors.js";
import { requestInterrupt } from "./interrupting.js";
import type { Cdp } from "./inspector.js";
import type { Session } from "./kernelState.js";
import { fire, send } from "./kernelState.js";

/** The kernel's interrupt hook as an evaluate's expression calls it. */
const hook = 'process[Symbol.for("jsnb.kernel.interrupt")]';

describe("the kernel state's failed sends (stub: a closed channel, a failing inspector call)", () => {
  it("logs a send the child refused and an inspector call that failed", async () => {
    const { context, session, logs } = world();
    const refuse = (_message: unknown, callback: (error: Error) => void) => {
      callback(new Error("closed"));
    };
    const refusing = { ...session, child: { send: refuse } };
    send(context, refusing as unknown as Session, { type: "shutdown" });
    const failing = { ...session.cdp, send: () => Promise.reject(new Error("gone")) };
    fire(context, failing, "Debugger.resume");
    await Promise.resolve();
    expect(logs).toEqual([
      expect.stringContaining("a message to the kernel failed"),
      expect.stringContaining("the inspector call Debugger.resume failed"),
    ]);
  });
});

describe("the kernel state's failed interrupt (stub: an evaluate that fails while the kernel lives)", () => {
  it("logs it, sends the interrupts asked for meanwhile and one more, then releases the held sends", async () => {
    const { context, session, sent, logs } = world();
    context.state.session = session;
    const evaluated: unknown[] = [];
    const answers: (() => void)[] = [];
    const cdp = {
      ...session.cdp,
      send: (_method: string, params?: unknown) => {
        evaluated.push(params);
        if (evaluated.length === 1) return Promise.reject(new Error("closed"));
        return new Promise<void>((resolve) => answers.push(resolve));
      },
    };
    void requestInterrupt(context, cdp, ["x_00000001"]);
    void requestInterrupt(context, cdp, ["x_00000002"]);
    send(context, session, { type: "snapshot", id: 1, names: [] });
    await Promise.resolve();
    expect([evaluated.length, sent, logs]).toEqual([
      2,
      [],
      [expect.stringContaining("Runtime.evaluate failed")],
    ]);
    answers[0]?.();
    await Promise.resolve();
    const followUp = `${hook}(["x_00000002"], true)`;
    expect([sent, evaluated.at(-1)]).toMatchObject([[], { expression: followUp }]);
    answers[1]?.();
    await Promise.resolve();
    expect(sent).toEqual([{ type: "snapshot", id: 1, names: [] }]);
  });
});

describe("the kernel state's failed second calls (stub: evaluates that fail while the kernel lives)", () => {
  it("sends a second call again each time it fails, five times at most, then releases the held sends", async () => {
    const { context, session, sent } = world();
    context.state.session = session;
    const evaluated: string[] = [];
    const cdp = {
      ...session.cdp,
      send: (_method: string, params?: unknown) => {
        evaluated.push(String(Reflect.get(Object(params), "expression")));
        if (evaluated.length === 1) return Promise.resolve(undefined);
        return Promise.reject(new Error("Execution was terminated"));
      },
    };
    void requestInterrupt(context, cdp, ["x_00000001"]);
    send(context, session, { type: "snapshot", id: 1, names: [] });
    // Each answer is a promise reaction: let them settle, as many as the calls take, until the held send goes out.
    for (let turn = 0; turn < 100 && sent.length === 0; turn += 1) await Promise.resolve();
    expect(evaluated).toEqual([
      `${hook}(["x_00000001"])`,
      ...Array.from({ length: 5 }, () => `${hook}(["x_00000001"], true)`),
    ]);
    expect(sent).toEqual([{ type: "snapshot", id: 1, names: [] }]);
  });
});

/** An inspector session whose evaluates answer `answers` in turn (an Error fails one), recording each expression. */
function answering(cdp: Cdp, answers: readonly unknown[]) {
  const evaluated: string[] = [];
  const send = (_method: string, params?: unknown): Promise<unknown> => {
    evaluated.push(String(Reflect.get(Object(params), "expression")));
    const answer = answers[evaluated.length - 1];
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { cdp: { ...cdp, send }, evaluated };
}

const answered = { result: { type: "undefined" } };
/** Stub: how the kernel fails an evaluate that ran while the one before it still had its termination pending. */
const lost = new InspectorFailed({
  method: "Runtime.evaluate",
  reason: "Execution was terminated",
});

/** The interrupts asked for at once (their executions), the evaluates' answers in turn, and the evaluates sent. */
const races = [
  ["a first evaluate that ended no execution", [[]], [lost], [`${hook}([])`, `${hook}([], true)`]],
  [
    "the evaluate of interrupts asked for meanwhile, which carries no execution",
    [["x_00000001"], []],
    [answered, lost],
    [`${hook}(["x_00000001"])`, `${hook}([])`, `${hook}([], true)`],
  ],
  [
    "a second call",
    [["x_00000001"]],
    [answered, lost],
    [
      `${hook}(["x_00000001"])`,
      ...Array.from({ length: 2 }, () => `${hook}(["x_00000001"], true)`),
    ],
  ],
] as const;

/** Asks for the interrupts of `calls` at once, a send held behind them; resolves with the evaluates and the sends. */
async function interrupted(calls: readonly (readonly string[])[], answers: readonly unknown[]) {
  const { context, session, sent } = world();
  context.state.session = session;
  const inspector = answering(session.cdp, answers);
  const settled = calls.map((ids) => requestInterrupt(context, inspector.cdp, ids));
  send(context, session, { type: "snapshot", id: 1, names: [] });
  await Promise.all(settled);
  return [inspector.evaluated, sent];
}

describe("the kernel state's lost races (stub: an evaluate that took the termination pending before it)", () => {
  for (const [name, calls, answers, evaluated] of races) {
    it(`follows ${name} with a second call when it fails, then releases the held sends`, async () => {
      const snapshot = { type: "snapshot", id: 1, names: [] };
      expect(await interrupted(calls, answers)).toEqual([evaluated, [snapshot]]);
    });
  }

  it("sends nothing more when every evaluate answered, the interrupts asked for meanwhile included", async () => {
    const snapshot = { type: "snapshot", id: 1, names: [] };
    expect(await interrupted([["x_00000001"], []], [answered, answered])).toEqual([
      [`${hook}(["x_00000001"])`, `${hook}([])`],
      [snapshot],
    ]);
  });
});

const refusal = { context: "Immediate", cell: "c_aaaaaa" } as const;
const refused = { result: { type: "object", value: refusal } };

// Stub: evaluates that answer a refusal. On a second call the real kernel gives one only when it loses a race, and a
// kernel gone while an evaluate is pending with interrupts queued behind it is a race too. A refusal on the first call,
// after which no second call goes out, is tested through the real child (interrupting.integration.test.ts).
describe("the kernel state's refusals (stub: evaluates that answer a refusal)", () => {
  it("settles an interrupt with its second call's refusal, then releases the held sends", async () => {
    const { context, session, sent } = world();
    context.state.session = session;
    const { cdp, evaluated } = answering(session.cdp, [{ result: { type: "undefined" } }, refused]);
    const settled = requestInterrupt(context, cdp, ["x_00000001"]);
    send(context, session, { type: "snapshot", id: 1, names: [] });
    expect(await settled).toEqual(refusal);
    expect([evaluated.length, sent]).toEqual([2, [{ type: "snapshot", id: 1, names: [] }]]);
  });

  it("settles the interrupts asked for meanwhile when the kernel is gone once the evaluate answers", async () => {
    const { context, session } = world();
    context.state.session = session;
    let answer = (): void => undefined;
    const send = (): Promise<unknown> =>
      new Promise((resolve) => {
        answer = () => {
          resolve(refused);
        };
      });
    const cdp = { ...session.cdp, send };
    const first = requestInterrupt(context, cdp, ["x_00000001"]);
    const queued = requestInterrupt(context, cdp, ["x_00000002"]);
    context.state.session = undefined;
    answer();
    expect([await first, await queued]).toEqual([refusal, undefined]);
  });
});
