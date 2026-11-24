// The files the page engine puts in DuckDB-WASM's virtual file system (a source to load, an export to read back)
// and their release; a file an interrupted statement still holds is dropped with the next release.
import { DuckDBDataProtocol } from "@duckdb/duckdb-wasm";

import { internalPrefix } from "../input.ts";
import type { Source } from "../sources.ts";
import { encodeSource } from "../sources.ts";
import type { Instance } from "./instance.ts";

let sequence = 0;

/** A fresh internal name (`__jsnb_<kind>_<n>`), never a name a caller may use. */
export const internalName = (kind: string): string => {
  sequence += 1;
  return `${internalPrefix}${kind}_${String(sequence)}`;
};

/**
 * Registers rows or an Arrow table (as JSON text) or a Blob (read through a file handle, never copied into an array)
 * as `file`; returns the columns the load casts back to UBIGINT (11-query §3).
 */
export async function registerSource(
  instance: Instance,
  file: string,
  table: string,
  source: Source,
): Promise<readonly string[]> {
  if (source.kind === "blob") {
    const blob = source.blob;
    await instance.track(() =>
      instance.db.registerFileHandle(file, blob, DuckDBDataProtocol.BROWSER_FILEREADER, true),
    );
    return [];
  }
  const encoded = encodeSource(table, source);
  await instance.track(() => instance.db.registerFileText(file, encoded.json));
  return encoded.unsigned;
}

const leftovers = new WeakMap<Instance, Set<string>>();

/** Drops `file` and any file an earlier release could not drop; never fails, so it cannot hide the call's error. */
export async function releaseFile(instance: Instance, file: string): Promise<void> {
  const pending = leftovers.get(instance) ?? new Set<string>();
  leftovers.set(instance, pending);
  pending.add(file);
  for (const name of [...pending]) {
    if (!instance.isAlive()) return;
    // After an interrupted statement DuckDB may still hold the file ("file is in use"): it stays pending.
    const dropped = await instance
      .track(() => instance.db.dropFile(name))
      .then(
        () => true,
        () => false,
      );
    if (dropped) pending.delete(name);
  }
}
