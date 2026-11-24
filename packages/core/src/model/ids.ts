// Identifier schemas of 03-api §2 (cell ids, execution ids, notebook refs), the API version and the id generator.
import { z } from "zod";

export const CellId = z.string().regex(/^c_[0-9a-z]{6}$/);
export type CellId = z.infer<typeof CellId>;

export const ExecutionId = z.string().regex(/^x_[0-9a-z]{8}$/);
export type ExecutionId = z.infer<typeof ExecutionId>;

/** A notebook ref is the path relative to the workspace root, never empty. */
export const NotebookRef = z.string().min(1);
export type NotebookRef = z.infer<typeof NotebookRef>;

/** `workspace.info.apiVersion` (03-api §1): bumped on renames and removals, not on additions. */
export const apiVersion = 1;

export type IdGenerator = {
  /** `c_` plus six lowercase base36 characters. */
  readonly cell: () => string;
  /** `x_` plus eight lowercase base36 characters. */
  readonly execution: () => string;
};

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Returns id generators drawing base36 characters from `random`, a source of numbers in `[0, 1)`. */
export function createIdGenerator(random: () => number): IdGenerator {
  const base36 = (length: number): string =>
    Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)] ?? "0").join("");
  return {
    cell: () => `c_${base36(6)}`,
    execution: () => `x_${base36(8)}`,
  };
}

const divisor = 2 ** 32;

/** Id generators over the platform's cryptographic random source (07-file-format §2). */
export function randomIds(): IdGenerator {
  const word = new Uint32Array(1);
  return createIdGenerator(() => {
    globalThis.crypto.getRandomValues(word);
    return (word[0] ?? 0) / divisor;
  });
}
