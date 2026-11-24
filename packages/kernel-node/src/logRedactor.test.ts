// Tests the kernel log's redaction on the daemon side: the workspace .env read at the first chunk, its secrets and the
// token prefixes masked, a changed .env picked up at a chunk 250 ms after the last look or at a refresh (an execute
// leaving for the kernel), a missing one meaning tokens only, and a .env that is not a regular file of at most 1 MiB
// (a directory, a FIFO (fixtures/fifo.ts), a larger file) refused at once with one notice per change, the secrets read
// last kept.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeFifo } from "./fixtures/fifo.js";
import { createLogRedactor } from "./logRedactor.js";

let workspace = "";
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "nimbo-log-"));
});
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** A Stripe-like token built at run time, so no key-shaped literal sits in the repository. */
const token = (prefix: string): string => prefix + "Ab1".repeat(8);
const envFile = () => join(workspace, ".env");

/** A redactor over a clock the test moves. */
function redactor() {
  const clock = { now: 0 };
  return { log: createLogRedactor(workspace, () => clock.now), clock };
}

describe("createLogRedactor", () => {
  it("masks the .env secrets and the tokens from the first chunk on, not the public values", () => {
    writeFileSync(
      envFile(),
      "SECRET=hunter2-hunter2\nPUBLIC_URL=https://shop.example\nSHORT=3000\n",
    );
    const { log } = redactor();
    expect(log.line("before hunter2-hunter2")).toBe("before hunter2-hunter2");
    expect(log.chunk()).toBeUndefined();
    const line = `fd1 hunter2-hunter2 ${token("sk_test_")} https://shop.example 3000`;
    expect(log.line(line)).toBe("fd1 *** *** https://shop.example 3000");
  });

  it("looks at a changed .env again 250 ms after the last look, or at once on a refresh", () => {
    writeFileSync(envFile(), "SECRET=hunter2-hunter2\n");
    const { log, clock } = redactor();
    log.chunk();
    writeFileSync(envFile(), "SECRET=another-secret-value\n");
    clock.now = 249;
    log.chunk();
    expect(log.line("another-secret-value")).toBe("another-secret-value");
    clock.now = 250;
    log.chunk();
    expect(log.line("another-secret-value hunter2-hunter2")).toBe("*** hunter2-hunter2");
    writeFileSync(envFile(), "SECRET=third-secret-value!\n");
    log.refresh();
    expect(log.line("third-secret-value!")).toBe("***");
    rmSync(envFile());
    log.refresh();
    expect(log.line(`third-secret-value! ${token("rk_")}`)).toBe("third-secret-value! ***");
  });
});

describe("createLogRedactor with a .env that is not a regular file", () => {
  it("refuses a directory, a FIFO or a larger .env with one notice per change, keeping the last secrets", () => {
    writeFileSync(envFile(), "SECRET=hunter2-hunter2\n");
    const { log } = redactor();
    log.refresh();
    const notices: (string | undefined)[] = [];
    mkdirSyncFresh(envFile());
    notices.push(log.refresh(), log.refresh());
    rmSync(envFile(), { recursive: true });
    makeFifo(envFile());
    notices.push(log.refresh());
    rmSync(envFile());
    writeFileSync(envFile(), `BIG=${"x".repeat(1024 * 1024)}\n`);
    notices.push(log.refresh());
    expect(log.line("hunter2-hunter2")).toBe("***");
    const parsed = notices.map((line): unknown =>
      line === undefined ? undefined : JSON.parse(line),
    );
    expect(parsed).toEqual([
      expect.objectContaining({ reason: "it is a directory, not a regular file" }),
      undefined,
      expect.objectContaining({ reason: "it is a FIFO (a named pipe), not a regular file" }),
      expect.objectContaining({ reason: "it holds 1048581 bytes, over the 1048576 allowed" }),
    ]);
  });
});

/** Replaces `path` with an empty directory. */
function mkdirSyncFresh(path: string): void {
  rmSync(path, { force: true });
  mkdirSync(path);
}
