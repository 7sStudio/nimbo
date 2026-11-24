// realm.reset (03-api §4.5, 05-bridge §8): the full reset, the bridge-only reset of a kernel restart, and detach's.
import type { RealmReset } from "@jsnb/core";

import { tombstone } from "../bridge/layer.js";
import { retire } from "./execute.js";
import type { RealmState } from "./state.js";

function clearLocal(state: RealmState): void {
  state.runs.clear();
  state.containers.removeAll();
  for (const name of Object.keys(state.record)) Reflect.deleteProperty(state.record, name);
  state.files.clear();
}

/** Every cell's disposers (a throw is a late error output), a run in progress `interrupted`, the record cleared. */
function resetAll(state: RealmState): void {
  for (const run of state.runs.values()) {
    run.disposers.run(run.reportError);
    retire(state, run, true);
  }
  clearLocal(state);
}

/** A kernel restart: client definitions, containers and timers stay; the current bridge layers become tombstones. */
function resetBridge(state: RealmState, restarted: NonNullable<RealmReset["bridge"]>): void {
  for (const run of state.runs.values()) tombstone(run.bridge, restarted);
}

export function reset(state: RealmState, params: RealmReset): Record<string, never> {
  if (params.bridge === undefined) resetAll(state);
  else resetBridge(state, params.bridge);
  return {};
}

/** Detach: the same local reset without a single report; a disposer that throws goes to `onError`. */
export function resetQuietly(state: RealmState): void {
  for (const run of state.runs.values()) {
    run.flags.stale = true;
    run.abandon();
  }
  for (const run of state.runs.values()) run.disposers.run(state.options.onError);
  clearLocal(state);
}
