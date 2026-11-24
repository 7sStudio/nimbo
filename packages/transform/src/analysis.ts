// Records what a cell defines, uses, exports and imports while it is rewritten, then freezes it as core's CellAnalysis.
import type { BindingKind, CellAnalysis } from "@jsnb/core";

export type Recorder = {
  /** A top-level declaration of `name` (with its kind) or a top-level write to a free name (without). */
  define(name: string, kind?: BindingKind): void;
  /** A read of a free name, at any depth. */
  use(name: string): void;
  export(name: string): void;
  import(specifier: string): void;
  freeze(): CellAnalysis;
};

/** A recorder for one cell; insertion order is source order because the rewrite walks the cell in order. */
export function createRecorder(): Recorder {
  const defines = new Set<string>();
  const uses = new Set<string>();
  const exports = new Set<string>();
  const imports = new Set<string>();
  const kinds: Record<string, BindingKind> = {};
  return {
    define(name, kind) {
      defines.add(name);
      if (kind !== undefined) kinds[name] = kind;
    },
    use(name) {
      uses.add(name);
    },
    export(name) {
      exports.add(name);
    },
    import(specifier) {
      imports.add(specifier);
    },
    freeze: () =>
      Object.freeze({
        defines: Object.freeze([...defines]),
        uses: Object.freeze([...uses]),
        exports: Object.freeze([...exports]),
        imports: Object.freeze([...imports]),
        kinds: Object.freeze({ ...kinds }),
      }),
  };
}
