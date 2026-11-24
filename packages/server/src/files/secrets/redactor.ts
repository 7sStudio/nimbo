// The daemon's own redaction (04-kernel §10, 08-code-standards §5): the rules kernel-node applies (non-public .env
// values of 8 characters or more, as written and escaped, and the sk_live_/sk_test_/rk_/whsec_ tokens) plus the daemon's
// token, for what leaves the daemon itself: its log lines and what a page reports. `.env` is looked at again when its
// identity changed, at most every 250 ms of use and at once after `refresh()` (a secrets.set).
import { statSync } from "node:fs";

import { createRedactor, maxEnvBytes, parseDotenv, secretValues } from "@jsnb/kernel-node";

import { readRegularFileSync } from "../regularFile.js";

export type DaemonRedactor = {
  readonly redact: (text: string) => string;
  /** Reads `.env` again now (after the daemon wrote it). */
  readonly refresh: () => void;
};

const everyMs = 250;

/** The .env's identity: missing, or its type, inode, mtime and size. */
function identityOf(path: string): string {
  try {
    const stats = statSync(path, { throwIfNoEntry: false });
    return stats ? [stats.isFile(), stats.ino, stats.mtimeMs, stats.size].join(":") : "missing";
  } catch (error) {
    return `unreadable:${error instanceof Error ? error.message : String(error)}`;
  }
}

/** A redactor over the `.env` at `envPath` and the `always` strings (the token); `now` is injectable for tests. */
export function createDaemonRedactor(
  envPath: string,
  always: readonly string[],
  now: () => number = performance.now.bind(performance),
): DaemonRedactor {
  let seen: string | undefined;
  let checkedAt = Number.NEGATIVE_INFINITY;
  let redact = createRedactor(always);
  const check = (): void => {
    checkedAt = now();
    const identity = identityOf(envPath);
    if (identity === seen) return;
    seen = identity;
    const read = readRegularFileSync(envPath, maxEnvBytes);
    // A .env that cannot be read keeps the secrets read last, as kernel-node's log redaction does (04-kernel §10).
    if (read.kind === "refused") return;
    const secrets = read.kind === "read" ? secretValues(parseDotenv(read.text)) : [];
    redact = createRedactor([...always, ...secrets]);
  };
  return {
    redact: (text) => {
      if (now() - checkedAt >= everyMs) check();
      return redact(text);
    },
    refresh: check,
  };
}
