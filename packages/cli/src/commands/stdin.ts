// Reading stdin: the whole of it (`--source -`, a piped secret) or one answer typed at a prompt, with or without its
// echo (a secret typed on a terminal is not shown).
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { Writable } from "node:stream";

/** Everything stdin holds, as UTF-8 text. */
export async function readAll(stdin: Readable): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stdin) {
    const piece: unknown = chunk;
    if (typeof piece === "string") text += piece;
    else if (piece instanceof Uint8Array) text += decoder.decode(piece, { stream: true });
  }
  return text + decoder.decode();
}

/** Swallows what readline echoes, so a typed secret never reaches the terminal. */
const muted = (): Writable =>
  new Writable({
    write: (_chunk, _encoding, done) => {
      done();
    },
  });

/** A typed answer, the end of input before one (Ctrl-D, an empty pipe), or Ctrl-C read by a raw-mode prompt. */
export type Answer =
  | { readonly kind: "line"; readonly text: string }
  | { readonly kind: "end" }
  | { readonly kind: "interrupted" };

/**
 * One line of stdin after `question` was written to `prompt` (stderr). Without echo the terminal is in raw mode, so
 * Ctrl-C arrives as readline's SIGINT event rather than as a signal: it is an answer of its own, never an empty line.
 */
export function ask(
  stdin: Readable,
  prompt: Writable,
  question: string,
  options: { readonly echo: boolean },
): Promise<Answer> {
  prompt.write(question);
  const lines = createInterface({
    input: stdin,
    ...(options.echo ? {} : { output: muted(), terminal: true }),
  });
  return new Promise((resolve) => {
    let settled = false;
    const settle = (answer: Answer): void => {
      if (settled) return;
      settled = true;
      lines.close();
      // Without echo the terminal shows no Enter; at the end of input (Ctrl-D) no Enter was typed at all.
      if (!options.echo || answer.kind !== "line") prompt.write("\n");
      resolve(answer);
    };
    lines.once("line", (text) => {
      settle({ kind: "line", text });
    });
    lines.once("SIGINT", () => {
      settle({ kind: "interrupted" });
    });
    lines.once("close", () => {
      settle({ kind: "end" });
    });
  });
}
