// The lines a log could not write (07-file-format §5, §7; rounds 2 and 3): the daemon log and each kernel log count the
// lines their file dropped (a full disk, a folder that refuses writes) and write one warning line that says how many
// and why before the next line they can write, in the shape pino writes, so a reader of the log sees the gap.
import type { RotatingFile } from "./rotatingFile.js";

/** The warning line that stands for `count` lines `log` dropped. */
const droppedLine = (log: string, count: number, reason: string): string =>
  `${JSON.stringify({
    level: "warn",
    time: new Date().toISOString(),
    pid: process.pid,
    dropped: count,
    reason,
    msg: `the ${log} could not write some lines; they are lost from the file`,
  })}\n`;

/**
 * Writes lines to `file` (`log` names it in the note), counting what it drops; the note goes before the next line it
 * can write, and to `noted` once written.
 */
export function droppingWriter(
  file: RotatingFile,
  log: string,
  noted: (note: string) => void = () => undefined,
): (line: string) => void {
  let dropped = 0;
  return (line) => {
    if (dropped > 0) {
      const note = droppedLine(log, dropped, file.lastFailure());
      if (file.write(note)) {
        noted(note);
        dropped = 0;
      }
    }
    if (!file.write(line)) dropped += 1;
  };
}
