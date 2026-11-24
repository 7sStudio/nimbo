// An emitter standing in for `process` in the in-process tests of the process-hook check (04-kernel §3.3), a stub
// named as one: replacing the test process's own nextTick or emit would deafen Vitest's own IPC, so the real process
// is tested through the real child (processHooks.integration.test.ts). Its nextTick is Node's real one, as an own
// property, and its emit EventEmitter's, inherited, as on `process`.
import { EventEmitter } from "node:events";

import type { HookedProcess } from "../processHooks.js";

/** Node's real nextTick, which the stand-in starts with. */
export const nodeTick = process.nextTick.bind(process);

/** EventEmitter's emit, which the stand-in inherits. */
export const nodeEmit: unknown = Reflect.get(EventEmitter.prototype, "emit");

/** What the tests read and replace on the stand-in. */
export type StandIn = HookedProcess & {
  nextTick: unknown;
  emit: unknown;
  on(event: "message", listener: (message: unknown) => void): unknown;
  listenerCount(event: "message"): number;
};

const isStandIn = (value: unknown): value is StandIn => value instanceof EventEmitter;

/** An emitter in process's place over `prototype` (EventEmitter's, or a subclass's). */
export function standIn(prototype: object = EventEmitter.prototype): StandIn {
  const proc: unknown = Object.create(prototype);
  if (!isStandIn(proc)) throw new Error("the stand-in's prototype is no EventEmitter's");
  Reflect.apply(EventEmitter, proc, []);
  proc.nextTick = nodeTick;
  return proc;
}

/** A replacement that queues nothing and drops everything. */
export const silent = (): void => undefined;
