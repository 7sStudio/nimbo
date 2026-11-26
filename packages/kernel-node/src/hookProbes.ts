// The delivery probes (processHooks.ts puts a differing hook aside, then probes it): each reads the
// replacement as Node would (its value, or what a cell's getter or Proxy gives back) and calls it as Node does, all as
// user code below the user-code frame, so an interrupt can stop a replacement or a getter that spins. The emit probe
// emits a private "message" that a listener of the kernel's, first in line, must hear; the nextTick probe queues a
// callback with an argument that must have run with it a turn later.
import { callUserCode } from "./builtins/userCode.js";
import type { Found } from "./descriptors.js";

const { apply, get } = Reflect;

/** A hook a probe reads: its key on `process`, and what reading it found when it was put aside. */
export type Probed = { readonly key: "nextTick" | "emit"; readonly found: Found };

/** The probe's listener calls: EventEmitter's own, captured at start, never a cell's replacement or accessor. */
export type Listeners = { readonly prepend: unknown; readonly remove: unknown };

/** A probe readied by the kernel: the call of the replacement (user code), its verdict a turn later, and its cleanup. */
export type Probe = {
  readonly call: () => void;
  readonly delivered: () => boolean;
  readonly end: () => void;
};

/** What the probe's listener throws once it heard the probe, so the emit stops before any cell's listener. */
const heardIt = new Error("the kernel's delivery probe, stopped once heard");

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === "function";

/** What Node reads for a hook: the value, or what a cell's getter or Proxy gives back (user code). */
function readAsNode(proc: object, { key, found }: Probed): unknown {
  switch (found.kind) {
    case "data":
      return found.value;
    case "accessor":
      return isFunction(found.get) ? apply(found.get, proc, []) : undefined;
    case "proxy":
      return get(found.proxy, key, proc);
    case "absent":
      return undefined;
  }
}

/** Reads and calls a replacement as Node would, on `proc`, as user code; a throw, or no function, delivers nothing. */
function callAsNode(proc: object, hook: Probed, args: readonly unknown[]): void {
  const read = (): void => {
    const replacement = readAsNode(proc, hook);
    if (isFunction(replacement)) apply(replacement, proc, args);
  };
  try {
    callUserCode(read, undefined, []);
  } catch {
    // A replacement, or its getter, that throws delivers nothing.
  }
}

/**
 * The emit probe: a private "message", with a listener of the kernel's first in line until the probe ends (so none of
 * the kernel's stays on the process, even when an interrupt stopped the call); delivered when heard synchronously.
 */
export function emitProbe(proc: object, hook: Probed, listeners: Listeners): Probe {
  const probe = {};
  let heard = false;
  let delivered = false;
  const listener = (message: unknown): void => {
    if (message !== probe) return;
    heard = true;
    throw heardIt;
  };
  if (isFunction(listeners.prepend)) apply(listeners.prepend, proc, ["message", listener]);
  return {
    call: () => {
      callAsNode(proc, hook, ["message", probe]);
      delivered = heard;
    },
    delivered: () => delivered,
    end: () => {
      if (isFunction(listeners.remove)) apply(listeners.remove, proc, ["message", listener]);
    },
  };
}

/** The nextTick probe: Node queues its delivery with arguments (the emit, the event, the message), so must this. */
export function tickProbe(proc: object, hook: Probed): Probe {
  const token = {};
  let ran = false;
  const callback = (argument: unknown): void => {
    ran = argument === token;
  };
  return {
    call: () => {
      callAsNode(proc, hook, [callback, token]);
    },
    delivered: () => ran,
    end: () => undefined,
  };
}
