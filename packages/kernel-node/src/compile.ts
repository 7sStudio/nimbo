// The compile step: once per cell and code, vm.runInThisContext under the cell's URL (the
// map's file), keeping the cell's SourceMap so error frames map back to the TypeScript source.
import { SourceMap } from "node:module";
import vm from "node:vm";

import type { CellId } from "@jsnb/core";
import { z } from "zod";

import { CellCodeInvalid } from "./builtins/errors.js";

export type CellFunction = (scope: Record<string, unknown>) => Promise<unknown>;

type Compiled =
  | { readonly ok: true; readonly fn: CellFunction }
  | { readonly ok: false; readonly error: unknown };

export type Compiler = {
  /** The cell function of `code`, compiled again only when the cell's code changed. */
  readonly compile: (cell: CellId, code: string, map: string) => Compiled;
  /** The source map of the latest code compiled for `cell`. */
  readonly mapFor: (cell: string) => SourceMap | undefined;
  /** The cell compiled under `url`, the exact filename its code runs under. */
  readonly cellOf: (url: string) => CellId | undefined;
  /** Every cell URL compiled so far; a new array whenever one is added. */
  readonly cellUrls: () => readonly string[];
};

/** The v3 map the transform emits: the cell URL as `file` and source, the TypeScript inside. */
const MapPayload = z.object({
  version: z.number(),
  file: z.string().optional(),
  sources: z.array(z.string()),
  sourcesContent: z.array(z.string()).optional(),
  names: z.array(z.string()),
  mappings: z.string(),
});

const isCellFunction = (value: unknown): value is CellFunction => typeof value === "function";

/** Captured when the module loads: a cell that replaces JSON.parse cannot stop later cells compiling. */
const parse = JSON.parse.bind(JSON);

type Built = { readonly fn: CellFunction; readonly map: SourceMap; readonly url: string };

function build(cell: CellId, code: string, mapText: string): Built {
  const payload = MapPayload.parse(parse(mapText));
  const filename = payload.file ?? payload.sources[0] ?? "jsnb:///cell.ts";
  const fn: unknown = vm.runInThisContext(code, { filename });
  if (!isCellFunction(fn)) throw new CellCodeInvalid({ cell });
  const map = new SourceMap({
    ...payload,
    file: filename,
    sourcesContent: payload.sourcesContent ?? [],
    sourceRoot: "",
  });
  return { fn, map, url: filename };
}

/** An empty compile cache. */
export function createCompiler(): Compiler {
  const cells = new Map<CellId, { readonly code: string; readonly fn: CellFunction }>();
  const maps = new Map<string, SourceMap>();
  const owners = new Map<string, CellId>();
  let urls: readonly string[] = [];
  return {
    compile: (cell, code, mapText) => {
      const cached = cells.get(cell);
      if (cached?.code === code) return { ok: true, fn: cached.fn };
      try {
        const { fn, map, url } = build(cell, code, mapText);
        cells.set(cell, { code, fn });
        maps.set(cell, map);
        if (!owners.has(url)) urls = [...urls, url];
        owners.set(url, cell);
        return { ok: true, fn };
      } catch (error) {
        // A code the transform let through but V8 refuses ends the run as an error, not the kernel.
        return { ok: false, error };
      }
    },
    mapFor: (cell) => maps.get(cell),
    cellOf: (url) => owners.get(url),
    cellUrls: () => urls,
  };
}
