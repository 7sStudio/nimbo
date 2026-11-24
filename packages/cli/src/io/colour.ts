// Whether the CLI colours a stream, decided in one place, and the SGR escapes it paints with.
import type { Io } from "./io.js";

/** Wraps `text` in the SGR `code` (`"2"`, `"1;31"`), or returns it as it is when colour is off. */
export type Paint = (code: string, text: string) => string;

export const sgr = {
  bold: "1",
  dim: "2",
  red: "31",
  green: "32",
  yellow: "33",
  cyan: "36",
  boldRed: "1;31",
} as const;

/**
 * Colour on `stream` when it is a terminal, `NO_COLOR` is empty or unset (no-color.org) and `TERM` is not `dumb`;
 * `FORCE_COLOR` other than `0` or `false` turns it on regardless, as Node's own streams read it.
 */
export function colourOn(
  io: Pick<Io, "env" | "outputIsTTY" | "errorIsTTY">,
  stream: "stdout" | "stderr",
): boolean {
  const force = io.env.FORCE_COLOR;
  if (force !== undefined && force !== "0" && force !== "false") return true;
  if (io.env.NO_COLOR !== undefined && io.env.NO_COLOR !== "") return false;
  if (io.env.TERM === "dumb") return false;
  return (stream === "stdout" ? io.outputIsTTY : io.errorIsTTY) === true;
}

export const painter =
  (on: boolean): Paint =>
  (code, text) =>
    on && text !== "" ? `\u001b[${code}m${text}\u001b[0m` : text;
