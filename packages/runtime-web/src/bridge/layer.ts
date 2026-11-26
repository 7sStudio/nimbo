// The bridge layer of one run: stubs, snapshot copies and error getters, and their tombstones.
import type { CellId, SnapshotBinding } from "@jsnb/core";
import { KernelRestarted, decode } from "@jsnb/core";

import { rebuildError } from "./rebuild.js";
import type { StubContext } from "./stub.js";
import { createStub } from "./stub.js";

type BindingKind = SnapshotBinding["kind"];

export type BridgeLayer = {
  /** What the scope view reads, after the record and before the builtins. */
  readonly values: Record<string, unknown>;
  readonly kinds: Map<string, BindingKind>;
};

export type RestartedNames = Readonly<
  Record<string, { readonly cell: CellId; readonly index: number }>
>;

export function createLayer(): BridgeLayer {
  return { values: { __proto__: null }, kinds: new Map() };
}

const defineValue = (layer: BridgeLayer, name: string, value: unknown): void => {
  Object.defineProperty(layer.values, name, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
};

const defineThrowing = (layer: BridgeLayer, name: string, error: () => Error): void => {
  Object.defineProperty(layer.values, name, {
    get: () => {
      throw error();
    },
    enumerable: true,
    configurable: true,
  });
};

/** Installs `realm.execute.bindings`: a stub per function, a deep copy per value, a throwing getter per error. */
export function install(
  layer: BridgeLayer,
  bindings: Readonly<Record<string, SnapshotBinding>>,
  context: StubContext,
): void {
  for (const [name, binding] of Object.entries(bindings)) {
    layer.kinds.set(name, binding.kind);
    if (binding.kind === "fn") defineValue(layer, name, createStub(name, context));
    else if (binding.kind === "value") defineValue(layer, name, decode(binding.json));
    else defineThrowing(layer, name, () => rebuildError(binding.error));
  }
}

/**
 * A kernel restart: a listed former stub rejects with KernelRestarted, a listed former snapshot throws
 * it when read, and a name the map does not list leaves the layer. The cell's next run installs fresh bindings.
 */
export function tombstone(layer: BridgeLayer, restarted: RestartedNames): void {
  for (const [name, kind] of layer.kinds) {
    const entry = Object.hasOwn(restarted, name) ? restarted[name] : undefined;
    if (entry === undefined) {
      Reflect.deleteProperty(layer.values, name);
      layer.kinds.delete(name);
      continue;
    }
    const error = () => new KernelRestarted({ name, cell: entry.cell, index: entry.index });
    if (kind === "fn") {
      defineValue(layer, name, () => Promise.reject(error()));
    } else defineThrowing(layer, name, error);
  }
}
