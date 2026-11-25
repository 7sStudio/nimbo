// What a cached package bundle's bare imports resolved to: each import's spec, the real folder it was
// resolved from and the URL chosen (null when nothing was found), kept beside the bundle (`<bundle>.imports.json`). A
// cached bundle is served only while each import still resolves to the same URL, from where it was resolved and with
// the page's own import of the name as it is now; after a `packages.add` that moves a folder (one now at the top level,
// or a dependency moved under its importer), the bundle is built again, so one folder keeps one URL. The check computes
// URLs and records nothing; a record that is missing or not what the schema says counts as changed. A record holds
// each (spec, folder) pair once (rxjs's held 48 lines, one per resolve call, for 5 pairs,
// each resolved again on every cache hit), and one written before that is read with its repeated lines once.
import { z } from "zod";

import { readRegularFile } from "../regularFile.js";
import type { Resolver } from "./bareImport.js";
import { bareUrlOf } from "./bareImport.js";
import { createLookups } from "./resolve.js";
import { parsedJson } from "./inputs.js";
import type { BareImport } from "./packagePlugin.js";

const Record = z.object({
  imports: z.array(z.object({ spec: z.string(), from: z.string(), url: z.string().nullable() })),
});

/** A record holds one line per bare import of a bundle: far below this. */
const maxRecordBytes = 16 * 1024 * 1024;

/** `lines` with each `keyOf` once, the first of each kept, in their order. */
function once<T>(lines: readonly T[], keyOf: (line: T) => string): T[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = keyOf(line);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The record's text: each (spec, folder) pair once, with the URL the build chose for it. */
export const importsText = (imports: readonly BareImport[]): string =>
  `${JSON.stringify({ imports: once(imports, ({ spec, from }) => JSON.stringify([spec, from])) })}\n`;

/** Whether every bare import the record at `path` names still resolves to the URL it chose. */
export async function importsUnchanged(resolver: Resolver, path: string): Promise<boolean> {
  const read = await readRegularFile(path, maxRecordBytes, { follow: false }); // a cache file: no link
  const record = read.kind === "read" ? Record.safeParse(parsedJson(read.text)).data : undefined;
  return record !== undefined && importsHold(resolver, record.imports);
}

/** Whether every bare import of a bundle still resolves to the URL its build chose. */
export async function importsHold(
  resolver: Resolver,
  imports: readonly BareImport[],
): Promise<boolean> {
  const lookups = createLookups();
  const lines = once(imports, (line) => JSON.stringify(line));
  const same = await Promise.all(
    lines.map(
      async ({ spec, from, url }) =>
        ((await bareUrlOf(resolver, spec, from, lookups)) ?? null) === url,
    ),
  );
  return same.every(Boolean);
}
