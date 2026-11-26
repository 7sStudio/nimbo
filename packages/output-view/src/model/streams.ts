// A run's printed lines as one block per stream: the kernel sends a stream in chunks (one per short window of
// printing), and chunks of the same stream next to each other read as one output. Anything between them (the other
// stream, a value, a display) keeps them apart, so the order of what was printed and returned stays as it was.
import type { Output } from "@jsnb/core";

/** One output to show, with the index of the first output it holds. */
export type ShownOutput<T extends Output = Output> = { readonly output: T; readonly index: number };

/** Joins each run of adjacent stream outputs of the same stream into one, at the index of its first chunk. */
export function mergeStreams<T extends Output>(
  outputs: readonly ShownOutput<T>[],
): ShownOutput<T | Output>[] {
  const merged: ShownOutput<T | Output>[] = [];
  for (const each of outputs) {
    const last = merged.at(-1);
    const { output } = each;
    if (
      last?.output.kind === "stream" &&
      output.kind === "stream" &&
      last.output.stream === output.stream
    )
      merged[merged.length - 1] = {
        index: last.index,
        output: { ...last.output, text: last.output.text + output.text },
      };
    else merged.push(each);
  }
  return merged;
}
