// One value output of `nimbo outputs` past the output limit: --full streams the full-value download to
// stdout chunk by chunk and cancels it once stdout's reader is gone (`| head`); a format reads the whole value when
// the kept one was cut. When the daemon does not hold it whole, pretty shows the kept part and says so on stderr,
// and json, ndjson and csv refuse (ValueCut): a cut value exported as data would read as a shorter one.
import type { DaemonOptions, ValueRef } from "@jsnb/client";
import { downloadValue } from "@jsnb/client";
import { InvalidParams } from "@jsnb/core";

import { ValueCut } from "../errors/output.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Format } from "./outputsFormat.js";

/** --full: the daemon's stream of the value, each chunk written as it arrives; cancelled when a write fails. */
export async function streamFull(io: Io, daemon: DaemonOptions, ref: ValueRef): Promise<void> {
  const response = await downloadValue(daemon, ref);
  const reader = response.body?.getReader();
  if (reader === undefined) return;
  let last = 0x0a;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      const piece: unknown = chunk.value;
      if (!(piece instanceof Uint8Array) || piece.length === 0) continue;
      await write(io.stdout, piece);
      last = piece[piece.length - 1] ?? last;
    }
    // Verbatim into a pipe or a file; on a terminal the line is ended, so the prompt does not join the JSON.
    if (io.outputIsTTY === true && last !== 0x0a) await write(io.stdout, "\n");
  } catch (error) {
    await reader.cancel(); // the rest is not wanted: the download stops, and the daemon notes its caller went away
    throw error;
  }
}

/** Which value a format reads, and how to name it if it cannot be had whole. */
export type Wanted = { readonly ref: ValueRef; readonly cell: string; readonly format: Format };

/** The value a format prints: its own json, or the whole value when it was cut (pretty: the kept part, said so). */
export async function formattable(
  io: Io,
  daemon: DaemonOptions,
  output: { readonly json: unknown; readonly truncated: boolean },
  wanted: Wanted,
): Promise<unknown> {
  if (!output.truncated) return output.json;
  try {
    const response = await downloadValue(daemon, wanted.ref);
    const whole: unknown = JSON.parse(await response.text());
    return whole;
  } catch (error) {
    // INVALID_PARAMS: the daemon does not hold the whole value (retention off, or past outputs.retainMaxBytes).
    if (!(error instanceof InvalidParams)) throw error;
    const { cell, format, ref } = wanted;
    const reason = error.data.issues[0]?.message ?? error.message;
    if (format !== "pretty")
      throw new ValueCut({ cell, index: ref.index, format }, reason, { cause: error });
    const note = `The value was cut at the output limit and the daemon does not hold it whole (${reason})`;
    await write(io.stderr, `${note}; this is the part that was kept.\n`);
    return output.json;
  }
}
