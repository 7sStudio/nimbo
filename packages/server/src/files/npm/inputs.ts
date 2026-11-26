// What a bundle of a linked package read:
// the real path, size and modification time of each input, taken before esbuild reads it (the build's onLoad), kept
// beside the cached bundle, which is built again once one of them changed (an edit; a new import changes the file that
// imports it). A save that lands during the build therefore differs from the record, and the next request builds
// again. A registry package's version says whether its files changed, so only linked packages need this.
import { stat } from "node:fs/promises";

import { z } from "zod";

import { readRegularFile } from "../regularFile.js";

const Input = z.object({ path: z.string(), size: z.number(), mtimeMs: z.number() });
export type Identity = z.infer<typeof Input>;

/** A record of a package's own files: far below this. */
const maxInputsBytes = 4 * 1024 * 1024;

/** JSON text, parsed; undefined when it is not JSON (a half-written cache file is no cache). */
export const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // not JSON: no cache, which the build replaces
  }
};

/** The file at `path` as it is now; undefined when it is gone. */
export async function identityOf(path: string): Promise<Identity | undefined> {
  const stats = await stat(path).catch(() => undefined); // gone: no identity, so no match
  return stats === undefined ? undefined : { path, size: stats.size, mtimeMs: stats.mtimeMs };
}

/** The record of a bundle's inputs, as the cache keeps it. */
export const recordText = (identities: readonly Identity[]): string =>
  `${JSON.stringify(identities)}\n`;

/** Whether every file the record at `recordPath` names is as it was; false when the record is missing or unreadable. */
export async function inputsUnchanged(recordPath: string): Promise<boolean> {
  const read = await readRegularFile(recordPath, maxInputsBytes, { follow: false }); // a cache file: no link
  if (read.kind !== "read") return false;
  const recorded = z.array(Input).safeParse(parsedJson(read.text));
  return recorded.success && identitiesHold(recorded.data);
}

/** Whether every file `identities` names is as it was; false for none (nothing to tell a change by). */
export async function identitiesHold(identities: readonly Identity[]): Promise<boolean> {
  if (identities.length === 0) return false;
  const now = await Promise.all(identities.map((input) => identityOf(input.path)));
  return identities.every((input, at) => {
    const current = now[at];
    return current?.size === input.size && current.mtimeMs === input.mtimeMs;
  });
}
