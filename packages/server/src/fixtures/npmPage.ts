// A page for the tests of /npm/ (04-kernel §8.1): the modules createNpmModules serves, fetched as a browser would
// (each import of a /npm/ URL fetched in turn), written to a folder with their /npm/ specifiers pointed at those files,
// and imported by Node, so a test runs the real bundles: one URL is one module instance, as on the page.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { NpmModule } from "../files/npm/npmModules.js";

type Npm = (rest: string, signal: AbortSignal) => Promise<NpmModule>;

/** A page over `npm`, its module files in `dir`: `load(url)` imports a /npm/ URL with everything it imports. */
export function npmPage(npm: Npm, dir: string) {
  const writes = new Map<string, Promise<void>>();
  const fileOf = (url: string): string =>
    join(dir, `${createHash("sha256").update(url).digest("hex").slice(0, 16)}.mjs`);
  const write = async (url: string): Promise<void> => {
    const answer = await npm(url.slice("/npm/".length), new AbortController().signal);
    if (!answer.ok) throw answer.error ?? new Error(`${url}: ${String(answer.status)}`);
    // Only where a module is imported: a require's URL is a key of the bundle's own maps, left as it is.
    const text = answer.body.replaceAll(
      /(\b(?:from|import)\s*\(?\s*)"(\/npm\/[^"]+)"/g,
      (_, before: string, imported: string) =>
        `${before}${JSON.stringify(pathToFileURL(visit(imported)).href)}`,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(fileOf(url), text);
  };
  /** The file of `url`, written once (a cycle of imports refers to a file still being written). */
  const visit = (url: string): string => {
    if (!writes.has(url)) writes.set(url, write(url));
    return fileOf(url);
  };
  const settled = async (): Promise<void> => {
    for (let size = -1; size !== writes.size;) {
      size = writes.size;
      await Promise.all(writes.values());
    }
  };
  return {
    load: async (url: string): Promise<Record<string, unknown>> => {
      const file = visit(url);
      await settled();
      const loaded: unknown = await import(pathToFileURL(file).href);
      return typeof loaded === "object" && loaded !== null ? { ...loaded } : {};
    },
    /** Every URL fetched so far, once each. */
    fetched: (): readonly string[] => [...writes.keys()],
  };
}
