// The cells' virtual filenames (the `sourceURL`) → cell and source map, for frames and late errors.
import { TraceMap } from "@jridgewell/trace-mapping";

export type CellFile = { readonly cell: string; readonly tracer: () => TraceMap | undefined };

export type CellFiles = {
  /** Records the run's map under its `file` (the `sourceURL`); a later run of the cell replaces it. */
  readonly register: (cell: string, map: string) => void;
  readonly find: (url: string) => CellFile | undefined;
  readonly clear: () => void;
};

const fileOf = (map: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(map);
    const file: unknown =
      typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "file") : undefined;
    return typeof file === "string" ? file : undefined;
  } catch {
    // A map that does not parse names no file: the cell's frames then keep their generated positions.
    return undefined;
  }
};

/** The tracer is built on first use and kept; a map it cannot read gives no tracer. */
const lazyTracer = (map: string): (() => TraceMap | undefined) => {
  let tracer: TraceMap | undefined;
  let tried = false;
  return () => {
    if (tried) return tracer;
    tried = true;
    try {
      tracer = new TraceMap(map);
    } catch {
      // An unreadable map maps nothing; the frame keeps its generated position.
      tracer = undefined;
    }
    return tracer;
  };
};

export function createCellFiles(): CellFiles {
  const byUrl = new Map<string, CellFile>();
  return {
    register: (cell, map) => {
      const file = fileOf(map);
      if (file !== undefined) byUrl.set(file, { cell, tracer: lazyTracer(map) });
    },
    find: (url) => byUrl.get(url),
    clear: () => {
      byUrl.clear();
    },
  };
}
