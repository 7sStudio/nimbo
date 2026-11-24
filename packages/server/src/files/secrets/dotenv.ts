// `.env` as secrets.set writes it (07-file-format §8): only the key's own line is rewritten (or one is appended), every
// other line, comment and the order kept; the value always double-quoted with `"`, `\` and newlines escaped. The file
// is read the way kernel-node reads it (non-blocking, regular files only, 1 MiB) and never written through a link.

import { JsnbError } from "@jsnb/core";
import { maxEnvBytes, parseDotenv } from "@jsnb/kernel-node";

import { isSymbolicLink, writeAtomically } from "../atomicWrite.js";
import { inOrder } from "../writeQueue.js";
import { readRegularFile } from "../regularFile.js";

type Where = { readonly path: string; readonly reason: string };
const unusableMessage = ({ path, reason }: Where): string =>
  `${path} cannot be used for secrets: ${reason}. Make it a regular file of at most 1 MiB, or edit it by hand.`;

/** The workspace `.env` cannot be read or written by the daemon (a FIFO, a directory, a link, too large). */
class EnvUnusable extends JsnbError {
  declare readonly data: Where;
  constructor(data: Where, options: { readonly cause?: unknown } = {}) {
    super({ name: "EnvUnusable", message: unusableMessage(data), data, ...options });
  }
}

/** `NAME="value"`, the value with `\`, `"` and newlines escaped, so parseDotenv reads back exactly `value`. */
export function envLine(name: string, value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `${name}="${escaped}"`;
}

const assigns = (line: string, name: string): boolean =>
  new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line);

/** `text` with `name` set to `value`: its last assignment rewritten in place (line ending kept), or one appended. */
export function withEnvValue(text: string, name: string, value: string): string {
  const lines = text.split("\n");
  const at = lines.findLastIndex((line) => assigns(line, name));
  if (at >= 0) {
    const crlf = (lines[at] ?? "").endsWith("\r") ? "\r" : "";
    lines[at] = `${envLine(name, value)}${crlf}`;
    return lines.join("\n");
  }
  const lead = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return `${lead}${envLine(name, value)}\n`;
}

/** The text of `.env`, "" when it does not exist; EnvUnusable when it cannot be read as a regular file. */
export async function readEnvText(path: string): Promise<string> {
  const read = await readRegularFile(path, maxEnvBytes);
  if (read.kind === "refused") throw new EnvUnusable({ path, reason: read.reason });
  return read.kind === "read" ? read.text : "";
}

/** The names `.env` assigns, in file order (07-file-format §8: never values, never process.env). */
export async function envNames(path: string): Promise<readonly string[]> {
  return Object.keys(parseDotenv(await readEnvText(path)));
}

/** Refuses a `.env` that is a symbolic link: replacing it would cut the link, writing through it may leave the workspace. */
async function assertWritable(path: string): Promise<void> {
  if (await isSymbolicLink(path)) {
    throw new EnvUnusable({
      path,
      reason: "it is a symbolic link, which nimbo does not write through",
    });
  }
}

/** Sets one secret: creates `.env` mode 0600 when absent, keeps an existing file's mode; one write at a time. */
export function setEnvValue(path: string, name: string, value: string): Promise<void> {
  return inOrder(path, async () => {
    await assertWritable(path);
    const text = await readEnvText(path);
    await writeAtomically(path, withEnvValue(text, name, value), { mode: 0o600 });
  });
}
