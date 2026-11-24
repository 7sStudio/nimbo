// Tests the workspace files kernel-node opens itself through the real child and the real daemon side (04-kernel §2,
// §8.1, §10), each made a FIFO (fixtures/fifo.ts), a directory or a file over 1 MiB, none of which may block anything:
// a FIFO .env at start ends the start with KernelDead at once, its EnvUnreadable report in the log; a FIFO or larger
// .env before a run ends that run with EnvUnreadable, and the next one answers once .env is a regular file again; the
// daemon's log redaction refuses a FIFO .env with one notice and keeps redacting with the secrets read last, while the
// kernel's lines keep arriving; a FIFO .jsnb/loader.mjs ends the start with LoaderWriteFailed at once, and so does a
// loader or a .jsnb that is a symbolic link out of the workspace, the file it points to left as it was.
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";

import type { KernelEvent } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { beforeAll, describe, expect, it } from "vitest";

import { makeFifo } from "./fixtures/fifo.js";
import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";

const secret = "s3cr3t-value-0123456789";
const fifoReason = "it is a FIFO (a named pipe), not a regular file";

const book = cellBook({
  sum: "1 + 1",
  gated: [
    "let open: () => void = () => undefined",
    "export const gate = new Promise<void>((resolve) => (open = resolve))",
    "export function release() { open() }",
  ].join("\n"),
  tell: 'await gate\nrequire("node:fs").writeSync(1, "told " + env.SECRET + "\\n")',
});

beforeAll(() => {
  book.compile(compileCell);
});

/** Replaces whatever is at `path` with a FIFO no one writes to. */
function fifoAt(path: string): void {
  rmSync(path, { recursive: true, force: true });
  makeFifo(path);
}

/** The terminal status event of a run. */
const terminal = (events: readonly KernelEvent[]): KernelEvent | undefined => events.at(-1);

describe("a .env that is not a regular file, at start", () => {
  it("ends the start at once with KernelDead, the EnvUnreadable report in the log", async () => {
    await withKernel(
      async ({ kernel, ws, seen }) => {
        fifoAt(ws.path(".env"));
        await expect(kernel.start()).rejects.toMatchObject({
          name: "KernelDead",
          data: { exitCode: 1 },
        });
        const report = seen.logs.join("\n");
        expect(report).toContain("EnvUnreadable");
        expect(report).toContain(fifoReason);
      },
      { start: false },
    );
  });
});

describe("a .env that is not a regular file, before a run", () => {
  it("ends the run with EnvUnreadable, and the next run answers once .env is a regular file", async () => {
    await withKernel(
      async ({ run, ws }) => {
        fifoAt(ws.path(".env"));
        expect(terminal(await run(book.cell("sum")))).toMatchObject({
          status: "error",
          error: { name: "EnvUnreadable", data: { reason: fifoReason } },
        });
        rmSync(ws.path(".env"));
        writeFileSync(ws.path(".env"), `BIG=${"x".repeat(1024 * 1024)}\n`);
        expect(terminal(await run(book.cell("sum")))).toMatchObject({
          error: {
            name: "EnvUnreadable",
            data: { reason: "it holds 1048581 bytes, over the 1048576 allowed" },
          },
        });
        writeFileSync(ws.path(".env"), `SECRET=${secret}\n`);
        expect(terminal(await run(book.cell("sum")))).toMatchObject({ status: "ok" });
      },
      { env: { SECRET: secret } },
    );
  });
});

describe("the daemon's log redaction with a .env that became a FIFO", () => {
  it("keeps the secrets read last, says so once, and the kernel's lines keep arriving", async () => {
    await withKernel(
      async ({ kernel, run, until, seen, ws }) => {
        await run(book.cell("gated"));
        const told = kernel.execute(book.cell("tell"))[Symbol.asyncIterator]();
        expect((await told.next()).value).toMatchObject({ status: "running" });
        fifoAt(ws.path(".env"));
        await kernel.call("release", []);
        await until(({ logs }) => logs.includes("told ***"));
        expect(terminal(await run(book.cell("sum")))).toMatchObject({
          error: { name: "EnvUnreadable" },
        });
        const notices = seen.logs.filter((line) =>
          line.includes("the workspace .env could not be read"),
        );
        expect(notices).toEqual([expect.stringContaining(fifoReason)]);
        expect(seen.logs.filter((line) => line.includes(secret))).toEqual([]);
      },
      { env: { SECRET: secret } },
    );
  });
});

describe("a .jsnb/loader.mjs that is a FIFO", () => {
  it("ends the start at once with LoaderWriteFailed", async () => {
    await withKernel(
      async ({ kernel, ws }) => {
        mkdirSync(ws.path(".jsnb"), { recursive: true });
        fifoAt(ws.path(".jsnb", "loader.mjs"));
        await expect(kernel.start()).rejects.toMatchObject({
          name: "LoaderWriteFailed",
          data: { reason: fifoReason },
        });
      },
      { start: false },
    );
  });
});

/** The two links of a workspace from someone else: the loader to a file outside, or .jsnb to a folder outside. */
const links: Record<string, (ws: Workspace, outside: Workspace) => void> = {
  loader: (ws, outside) => {
    mkdirSync(ws.path(".jsnb"));
    symlinkSync(outside.path("user.mjs"), ws.path(".jsnb", "loader.mjs"));
  },
  folder: (ws, outside) => {
    symlinkSync(outside.dir, ws.path(".jsnb"));
  },
};

describe("a .jsnb/loader.mjs or a .jsnb that is a symbolic link out of the workspace", () => {
  for (const [name, link] of Object.entries(links)) {
    it(`ends the start with LoaderWriteFailed (${name}), the file it points to left as it was`, async () => {
      await withWorkspace(async (outside) => {
        writeFileSync(outside.path("user.mjs"), "the user's own file");
        await withKernel(
          async ({ kernel, ws }) => {
            link(ws, outside);
            await expect(kernel.start()).rejects.toMatchObject({ name: "LoaderWriteFailed" });
          },
          { start: false },
        );
        expect([readFileSync(outside.path("user.mjs"), "utf8"), readdirSync(outside.dir)]).toEqual([
          "the user's own file",
          ["user.mjs"],
        ]);
      });
    });
  }
});
