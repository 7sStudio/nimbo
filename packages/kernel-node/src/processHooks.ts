// Node's IPC delivery as a cell can reach it: Node hands every daemon message to the kernel through
// the process.nextTick and process.emit it looks up at that moment, and calls a send back through process.nextTick, so
// a cell that replaces either with something that does not call Node's own (fake timers do, for nextTick; a getter
// that throws) would make the kernel deaf. The kernel captures Node's own two at start. After user code, and on an
// interval, it compares the live ones through their descriptors (descriptors.ts), never calling a getter, with what it
// saw last: Node's own, or a replacement it kept. One that differs (a function, an accessor, a Proxy on the chain) is
// put aside at once for Node's own, so the kernel hears the daemon while it decides, and probed on the next turns as
// Node reads and calls it: a private "message" emitted through it must reach a listener the kernel puts first for that
// moment (which stops it there, so no cell's listener sees it), and a callback queued through it with an argument must
// have run with that argument when a captured setImmediate fires. A replacement that delivers (a wrapper that calls the
// original: signal-exit's emit, an APM agent's nextTick, a spy) is put back as it was and kept, remembered by its
// identity and its descriptor: no check calls it again while it stays the same, so a spy records no call of the
// kernel's and a logging wrapper prints nothing while the kernel idles. Only the interrupt hook's check probes a kept
// one again, put aside the same way: a kept wrapper that stopped delivering, which leaves the kernel deaf, is found when
// the user interrupts. One that does not deliver stays replaced by Node's own, and the caller reports it; a check leaves
// to its probe the replacement one awaits, and only the latest probe of a hook decides. No user code runs inside the
// kernel's checks or its interrupt hook: the probes read the replacement (its getter, its traps) and call it a turn
// later, as user code, in a promise job of its own below the user-code frame, so an interrupt can stop a
// replacement that spins, and stops only it, never the decision a turn on.
import { startUserCode } from "./builtins/userCode.js";
import type { Found } from "./descriptors.js";
import {
  bare,
  findProperty,
  holdsValue,
  ownDescriptor,
  sameDescriptor,
  sameFound,
} from "./descriptors.js";
import type { Listeners } from "./hookProbes.js";
import { emitProbe, tickProbe } from "./hookProbes.js";

/** A process hook a cell can replace. */
type HookName = "process.nextTick" | "process.emit";

/** A replacement that did not deliver: `restored` is false when Node's own could not be put back (non-configurable). */
export type HookFinding = { readonly name: HookName; readonly restored: boolean };

/** The slice of `process` the hooks need beyond the two properties: a first "message" listener during an emit probe. */
export type HookedProcess = {
  prependListener(event: "message", listener: (message: unknown) => void): unknown;
  removeListener(event: "message", listener: (message: unknown) => void): unknown;
};

/** Runs a probe's call of a replacement: under the store of the cell blamed for it (hookReports.ts). */
type RunAs = (call: () => void) => void;

/** A check: the replacements that did not deliver once its probes decided, or undefined when it probes nothing. */
type Check = (runAs: RunAs) => Promise<readonly HookFinding[]> | undefined;

export type ProcessHooks = {
  /** Runs `fn` with Node's own nextTick in place, so a callback Node queues inside it (a send's) is never lost. */
  readonly withNodeNextTick: <T>(fn: () => T) => T;
  /**
   * After user code, and on the interval: puts a hook that differs from what the kernel saw last (Node's own, or the
   * replacement it kept) aside for Node's own now and resolves with the replacements that did not deliver, once the
   * probes decided (two turns later); undefined at once when nothing differs or a probe already awaits it. `runAs` runs
   * each probe's call of a replacement (under the store of the cell blamed for it, so an interrupt of that cell's
   * execution can stop a replacement that spins).
   */
  readonly check: Check;
  /** The interrupt hook's check: the same, and a kept replacement is put aside and probed again too. */
  readonly recheck: Check;
};

const { defineProperty, deleteProperty, get } = Reflect;
/** Captured when the module loads, before any cell runs: the turns the probes wait for and the promise they settle. */
const { setImmediate: nextTurn, Promise: NativePromise } = globalThis;

type Key = "nextTick" | "emit";

/** A hook as Node set it up: its value, and its own property (undefined when inherited, as `emit` is). */
type Hook = {
  readonly name: HookName;
  readonly key: Key;
  readonly node: unknown;
  readonly own: PropertyDescriptor | undefined;
};

/** What a check saw of a replaced hook: what Node would read, and the own property it lives in (none when inherited). */
type Seen = { readonly found: Found; readonly property: PropertyDescriptor | undefined };

/** A replacement to probe: the hook, what was seen of it, and whether Node's own took its place meanwhile. */
type Aside = Seen & { readonly hook: Hook; readonly swapped: boolean };

/** The same replacement: the same value, getter or Proxy, in the same own property (value, accessors, attributes). */
const sameSeen = (a: Seen, b: Seen): boolean =>
  sameFound(a.found, b.found) && sameDescriptor(a.property, b.property);

/** Node's own hook, read at start, before any cell runs (so no getter of a cell's exists yet). */
function capture(proc: object, name: HookName, key: Key): Hook {
  return { name, key, node: get(proc, key), own: ownDescriptor(proc, key) };
}

/** True when `proc` still reads Node's own hook: in a data property, or nowhere when it had none (a stand-in). */
function isNode(proc: object, hook: Hook): boolean {
  return hook.node === undefined
    ? findProperty(proc, hook.key).kind === "absent"
    : holdsValue(proc, hook.key, hook.node);
}

/** Puts Node's own `hook` back on `proc`; false when the property cannot be redefined (non-configurable, read-only). */
function putNode(proc: object, hook: Hook): boolean {
  const { key, node, own } = hook;
  if (own) {
    if (!defineProperty(proc, key, own)) defineProperty(proc, key, bare({ value: node }));
  } else if (!deleteProperty(proc, key) || !isNode(proc, hook)) {
    // Inherited at start, and the prototype's was replaced too (or the own one cannot go): shadow it with Node's own.
    if (!defineProperty(proc, key, bare({ value: node, writable: true, configurable: true })))
      defineProperty(proc, key, bare({ value: node }));
  }
  return isNode(proc, hook);
}

/** Puts a replacement back as it was: its own property, or none when it was inherited from a replaced prototype. */
function putBack(proc: object, key: Key, property: PropertyDescriptor | undefined): void {
  if (property) defineProperty(proc, key, property);
  else deleteProperty(proc, key);
}

/** The replacements kept (found to deliver), and the probe each hook awaits (the latest), by key. */
type Memory = { readonly kept: Map<Key, Seen>; readonly pending: Map<Key, Aside> };

/**
 * A hook to probe, put aside with Node's own in its place so the kernel hears the daemon while it decides: one that
 * differs from what the kernel saw last, or, `again` (the interrupt's check), the replacement it kept. Undefined for
 * Node's own, for a kept replacement that stayed the same, and for the replacement a probe already awaits; one the cell
 * put in its place since is probed now, and that probe decides.
 */
function aside(proc: object, hook: Hook, memory: Memory, again: boolean): Aside | undefined {
  const { key } = hook;
  if (isNode(proc, hook)) {
    // Node's own, and no probe of the kernel's put it there: a replacement made after it is a new one.
    if (!memory.pending.has(key)) memory.kept.delete(key);
    return undefined;
  }
  const seen = { found: findProperty(proc, key), property: ownDescriptor(proc, key) };
  const pending = memory.pending.get(key);
  if (pending !== undefined && sameSeen(seen, pending)) return undefined;
  const kept = memory.kept.get(key);
  if (!again && kept !== undefined && sameSeen(seen, kept)) return undefined;
  const put = { ...seen, hook, swapped: putNode(proc, hook) };
  memory.pending.set(key, put);
  return put;
}

/** True when the cell replaced the hook again while it was probed: the next check probes the new one. */
const replacedAgain = (proc: object, put: Aside): boolean =>
  put.swapped ? !isNode(proc, put.hook) : !sameFound(findProperty(proc, put.hook.key), put.found);

/**
 * Keeps a replacement that delivered (put back where it was put aside); one that did not is a finding, Node's own put
 * in its place now when it could not be put aside (locked in place).
 */
function decide(proc: object, put: Aside, delivered: boolean, memory: Memory): HookFinding[] {
  const { name, key } = put.hook;
  // A later probe of this hook decides instead (the cell replaced it again and a check saw it).
  if (memory.pending.get(key) !== put) return [];
  memory.pending.delete(key);
  if (replacedAgain(proc, put)) return [];
  if (!delivered) {
    memory.kept.delete(key);
    return [{ name, restored: put.swapped || putNode(proc, put.hook) }];
  }
  if (put.swapped) putBack(proc, key, put.property);
  memory.kept.set(key, { found: put.found, property: put.property });
  return [];
}

/** Probes what was put aside on the next turn, each call a promise job of its own, and decides on the turn after. */
function probed(
  proc: object,
  put: readonly Aside[],
  listeners: Listeners,
  memory: Memory,
  runAs: RunAs,
): Promise<readonly HookFinding[]> {
  return new NativePromise((resolve) => {
    nextTurn(() => {
      const probes = put.map(({ hook: { key }, found }) =>
        key === "emit"
          ? emitProbe(proc, { key, found }, listeners)
          : tickProbe(proc, { key, found }),
      );
      for (const probe of probes)
        startUserCode(() => {
          runAs(probe.call);
        });
      nextTurn(() => {
        const findings = put.flatMap((one, index) => {
          const probe = probes[index];
          probe?.end();
          return decide(proc, one, probe?.delivered() === true, memory);
        });
        resolve(findings);
      });
    });
  });
}

/** Runs `fn` with Node's own nextTick in place of a replacement, which is put back afterwards. */
function underNodeTick<T>(proc: object, tick: Hook, fn: () => T): T {
  if (isNode(proc, tick)) return fn();
  const property = ownDescriptor(proc, tick.key);
  if (!putNode(proc, tick)) return fn();
  try {
    return fn();
  } finally {
    putBack(proc, tick.key, property);
  }
}

/** Captures Node's own process.nextTick and process.emit of `proc`, and its listener calls, before any cell runs. */
export function captureProcessHooks(proc: HookedProcess): ProcessHooks {
  const tick = capture(proc, "process.nextTick", "nextTick");
  const emit = capture(proc, "process.emit", "emit");
  const listeners = { prepend: get(proc, "prependListener"), remove: get(proc, "removeListener") };
  const memory: Memory = { kept: new Map(), pending: new Map() };
  const checked = (again: boolean, runAs: RunAs): ReturnType<Check> => {
    const put = [aside(proc, tick, memory, again), aside(proc, emit, memory, again)].filter(
      (one) => one !== undefined,
    );
    return put.length === 0 ? undefined : probed(proc, put, listeners, memory, runAs);
  };
  return {
    withNodeNextTick: (fn) => underNodeTick(proc, tick, fn),
    check: (runAs) => checked(false, runAs),
    recheck: (runAs) => checked(true, runAs),
  };
}
