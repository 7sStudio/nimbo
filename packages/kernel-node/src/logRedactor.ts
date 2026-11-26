// The kernel log's redaction on the daemon side: every line the child writes to its stdout and
// stderr pipes (a raw write to fd 1 or 2, a crash report) and every notice of the daemon side passes the redaction
// outputs pass, built from the workspace .env with the same rules. The one redacting boundary of the log: the child
// does not redact it. The .env is read again when its identity (type, inode, mtime, size) changed, checked at most once
// every 250 ms of the child's output and whenever an `execute` leaves for the kernel (which re-reads it then): a stat
// per chunk was the daemon's latency per chunk on a slow mount. It is read only as a regular file of at most 1 MiB,
// opened without blocking, since a FIFO with no writer froze the daemon's event loop and every kernel it served;
// anything else is one notice per change of the file, and the redaction keeps the secrets read last.
import { statSync } from "node:fs";
import { join } from "node:path";

import { maxEnvBytes, parseDotenv, secretValues } from "./builtins/dotenv.js";
import type { LogFilter } from "./ipc/kernelState.js";
import { notice } from "./ipc/notice.js";
import { readRegularFileSync } from "./ipc/regularFile.js";
import { createRedactor } from "./outputs/redact.js";

/** How often the child's output may make the redactor look at .env again. */
const everyMs = 250;

/** The .env's identity: "missing", its type, inode, mtime and size, or why it could not be looked at. */
function identityOf(path: string): string {
  try {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) return "missing";
    return [stat.isFile() ? "file" : "other", stat.ino, stat.mtimeMs, stat.size].join(":");
  } catch (error) {
    return `unreadable:${error instanceof Error ? error.message : String(error)}`;
  }
}

/** The log filter of `workspace`, its clock injectable: no secret known until the first check reads its .env. */
export function createLogRedactor(workspace: string, now: () => number = Date.now): LogFilter {
  const path = join(workspace, ".env");
  let seen: string | undefined;
  let checkedAt = Number.NEGATIVE_INFINITY;
  let redact = createRedactor([]);
  const check = (): string | undefined => {
    checkedAt = now();
    const identity = identityOf(path);
    if (identity === seen) return undefined;
    seen = identity;
    const read = readRegularFileSync(path, maxEnvBytes);
    if (read.kind === "refused") {
      const msg =
        "the workspace .env could not be read, so the kernel log is redacted with the secrets read last";
      return notice(msg, { path, reason: read.reason });
    }
    redact = createRedactor(read.kind === "read" ? secretValues(parseDotenv(read.text)) : []);
    return undefined;
  };
  return {
    chunk: () => (now() - checkedAt >= everyMs ? check() : undefined),
    refresh: check,
    line: (text) => redact(text),
  };
}
