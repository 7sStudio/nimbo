// Where js-debug's socket goes: with a TMPDIR too long for a socket's path, the real js-debug still listens (in a
// short private directory under /tmp) and answers a DAP initialize; that directory is made only when nothing is there
// yet; the start's sweep removes such a directory once nothing answers in it.
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { quiet } from "../../fixtures/workspace.js";
import { createAdapter, makePrivateDir, removeStale, socketDir } from "./adapter.js";

const posix = process.platform !== "win32";
const made: string[] = [];
const savedTmpdir = process.env.TMPDIR;

/** A TMPDIR whose socket path would be well over 104 bytes. */
function longTmpdir(): string {
  const base = mkdtempSync(join(tmpdir(), "nimbo-long-"));
  made.push(base);
  const long = join(base, "a".repeat(60), "b".repeat(60));
  mkdirSync(long, { recursive: true });
  return long;
}

afterEach(() => {
  if (savedTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = savedTmpdir;
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.runIf(posix)("the debugger's socket", () => {
  it("listens and answers with a TMPDIR too long for a socket's path", async () => {
    process.env.TMPDIR = longTmpdir();
    const adapter = createAdapter({ log: quiet });
    try {
      const dap = await adapter.connect();
      const body = await dap.send("initialize", { adapterID: "pwa-node", clientID: "nimbo" });
      expect(body).toEqual(expect.objectContaining({ supportsConfigurationDoneRequest: true }));
      dap.close();
    } finally {
      adapter.stop();
    }
  }, 30_000);
});

describe.runIf(posix)("the debugger's socket directory", () => {
  it("puts a long TMPDIR's socket in a short 0700 directory of this user", () => {
    process.env.TMPDIR = longTmpdir();
    const dir = socketDir();
    made.push(dir);
    expect(Buffer.byteLength(join(dir, "dap.sock"))).toBeLessThan(100);
    const found = statSync(dir);
    expect(found.mode & 0o777).toBe(0o700);
    expect(found.uid).toBe(process.getuid?.());
  });

  it("keeps a short TMPDIR's socket under TMPDIR", () => {
    const short = mkdtempSync(join("/tmp", "nimbo-t-"));
    made.push(short);
    process.env.TMPDIR = short;
    expect(socketDir().startsWith(`${short}/nimbo-debug-`)).toBe(true);
  });

  it("refuses a directory or a symlink that is there already", () => {
    const base = mkdtempSync(join(tmpdir(), "nimbo-pre-"));
    made.push(base);
    const open = join(base, "open");
    mkdirSync(open, { mode: 0o755 });
    expect(() => {
      makePrivateDir(open);
    }).toThrow(/EEXIST/u);
    const link = join(base, "link");
    symlinkSync(open, link);
    expect(() => {
      makePrivateDir(link);
    }).toThrow(/EEXIST/u);
  });
});

describe.runIf(posix)("the sweep of js-debug directories", () => {
  it("sweeps a short directory nothing answers in", async () => {
    process.env.TMPDIR = longTmpdir();
    const dir = socketDir();
    made.push(dir);
    const old = new Date(Date.now() - 60_000);
    utimesSync(dir, old, old);
    await removeStale(quiet);
    expect(() => statSync(dir)).toThrow(/ENOENT/u);
  });
});
