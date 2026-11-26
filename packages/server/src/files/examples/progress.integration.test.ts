// The tutorial's progress on a real daemon and a real kernel: what examples.list says of a lesson as its copy is made,
// opened and run in, the cells that do not count (one the learner added, a run in a copy at another path), what
// survives a restart of the daemon in `.jsnb/tutorial.json`, and a file there that is not the record or is a link.
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { Daemon } from "../../fixtures/daemon.js";
import { startDaemon, withDaemon } from "../../fixtures/daemon.js";

const first = "tutorial/01-first-steps";
const copy = `${first}.jsnb`;
/** The server cells of the first lesson, in order. */
const code = ["c_t10003", "c_t10005", "c_t10008", "c_t10009"];

const lessonOf = async (daemon: Daemon, name = first) => {
  const { examples } = await daemon.client.examples.list({});
  const found = examples.find((each) => each.name === name);
  if (found === undefined) throw new Error(`${name} is not listed`);
  return found;
};

const run = (daemon: Daemon, notebook: string, cell: string) =>
  daemon.client.cell.run({ notebook, cell, timeoutMs: 60_000 });

describe("the tutorial's progress", () => {
  it("is new until the copy is opened, started then, done once every code cell ran there", async () => {
    await withDaemon(async (daemon) => {
      const { examples } = await daemon.client.examples.list({});
      for (const each of examples) {
        if (each.kind === "example") expect(each.progress).toBeUndefined();
        else expect(each.progress).toMatchObject({ state: "new", ran: 0, lastActive: null });
      }
      expect((await lessonOf(daemon)).minutes).toBe(8);
      expect((await lessonOf(daemon)).progress?.of).toBe(code.length);
      expect(
        examples.filter((each) => each.kind === "example").map((each) => each.minutes),
      ).toEqual([null, null, null, null, null]);

      await daemon.client.examples.copy({ name: "tutorial" });
      expect((await lessonOf(daemon)).progress?.state).toBe("new");

      await daemon.client.notebook.open({ path: copy });
      const opened = (await lessonOf(daemon)).progress;
      expect(opened).toMatchObject({ state: "started", ran: 0, of: code.length });
      expect(opened?.lastActive).toEqual(expect.any(String));

      await run(daemon, copy, code[0] ?? "");
      const added = await daemon.client.cell.add({ notebook: copy, type: "server", source: "1" });
      await run(daemon, copy, added.cell.id);
      expect((await lessonOf(daemon)).progress).toMatchObject({ state: "started", ran: 1 });

      // a copy elsewhere is the learner's own notebook: its runs count for nothing
      const other = await daemon.client.examples.copy({ name: first });
      expect(other.path).toBe(`${first}-2.jsnb`);
      await daemon.client.notebook.open({ path: other.path });
      for (const cell of code) await run(daemon, other.path, cell);
      expect((await lessonOf(daemon)).progress).toMatchObject({ state: "started", ran: 1 });

      for (const cell of code.slice(1)) await run(daemon, copy, cell);
      expect((await lessonOf(daemon)).progress).toMatchObject({ state: "done", ran: 4, of: 4 });
      expect((await lessonOf(daemon, "tutorial/02-outputs")).progress?.state).toBe("new");
    });
  }, 120_000);

  it("is kept in .jsnb/tutorial.json across a restart of the daemon", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.examples.copy({ name: first });
      await daemon.client.notebook.open({ path: copy });
      await run(daemon, copy, code[1] ?? "");
      const before = (await lessonOf(daemon)).progress;
      await daemon.stop();

      const file = ws.path(".jsnb", "tutorial.json");
      expect((await lstat(file)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
        version: 1,
        lessons: { [first]: { lastActive: before?.lastActive, ran: [code[1]] } },
      });
      const again = await startDaemon(ws);
      expect((await lessonOf(again)).progress).toEqual(before);
    });
  }, 60_000);

  it("starts over from a file that is not the record, and never reads through a link", async () => {
    await withDaemon(async (daemon, ws) => {
      await writeFile(ws.path(".jsnb", "tutorial.json"), '{ "version": 2, "lessons": [] }\n');
      expect((await lessonOf(daemon)).progress?.state).toBe("new");
      await daemon.stop();

      await mkdir(ws.path("elsewhere"));
      const planted = JSON.stringify({
        version: 1,
        lessons: { [first]: { lastActive: "2026-01-01T00:00:00.000Z", ran: code } },
      });
      await writeFile(ws.path("elsewhere", "progress.json"), planted);
      await rm(ws.path(".jsnb", "tutorial.json"));
      await symlink(ws.path("elsewhere", "progress.json"), ws.path(".jsnb", "tutorial.json"));
      const again = await startDaemon(ws);
      expect((await lessonOf(again)).progress?.state).toBe("new");

      await again.client.examples.copy({ name: first });
      await again.client.notebook.open({ path: copy });
      await again.stop();
      expect((await lstat(ws.path(".jsnb", "tutorial.json"))).isSymbolicLink()).toBe(false);
      expect(await readFile(ws.path("elsewhere", "progress.json"), "utf8")).toBe(planted);
    });
  }, 60_000);
});
