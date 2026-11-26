// The `console` built-in: a node:console Console whose stdout and stderr hand their text to a
// writer, so console.log/info/debug become stdout and console.warn/error stderr, formatted by util.format. The
// streams keep no state of their own: an interrupt can stop user code inside console.log, and a
// node:stream Writable stopped in the middle of a write stays "writing" and holds every later chunk of every cell.
import { Console } from "node:console";
import { Writable } from "node:stream";

import type { StreamName } from "./sink.js";

export type StreamWriter = (stream: StreamName, text: string) => void;

/**
 * A stream whose `write` hands the chunk to `write` at once: an own method over the Writable's, so none of the
 * Writable's buffering state is ever used (a Console with ignoreErrors false only ever calls `write(string)`).
 */
function streamTo(stream: StreamName, write: StreamWriter): Writable {
  const writable = new Writable();
  writable.write = (chunk: unknown): boolean => {
    write(stream, String(chunk));
    return true;
  };
  return writable;
}

/** A Console over `write`, without colours and without the error listeners a real stream would need. */
export function createConsole(write: StreamWriter): Console {
  return new Console({
    stdout: streamTo("stdout", write),
    stderr: streamTo("stderr", write),
    colorMode: false,
    ignoreErrors: false,
  });
}
