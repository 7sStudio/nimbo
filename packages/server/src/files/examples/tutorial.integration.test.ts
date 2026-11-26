// The tutorial's lessons kept true on a real daemon, a real kernel and, where a Chrome, Chromium or Edge is installed,
// the headless page: each lesson parses with no warning and is in the file format's exact form with no saved outputs,
// is copied into a workspace of its own with no package, no network and no .env, and every code cell run in order
// ends as its lesson says (the table below names the cells a lesson makes fail on purpose; every other cell ends ok).
// The values a lesson quotes in its text are checked against the cells' results. Without a browser the client cells
// are left out, with the reason in the test's name.
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Execution } from "@jsnb/core";
import { parse, randomIds, serialize } from "@jsnb/core";
import { buildHeadlessPage, buildRealmPage } from "@jsnb/test-tools/realm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Daemon } from "../../fixtures/daemon.js";
import { withDaemon } from "../../fixtures/daemon.js";
import { valueOf } from "../../fixtures/notebook.js";
import { findBrowser } from "../../kernel/headless/executable.js";
import { shippedExamples } from "./examples.js";

const lessonsFolder = join(shippedExamples, "tutorial");
const browser = findBrowser(null).found;
const withoutBrowser = browser
  ? ""
  : " (client cells skipped: no Chrome, Chromium or Edge on this machine)";

/** The cells each lesson makes fail on purpose, with the error's name; the others end ok. */
const failing: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "02-outputs": { c_t20014: "Error" },
  "04-client-and-bridge": { c_t40018: "NotTransferable" },
  // no package is installed here and no secret set: the install is the lesson's first step
  "05-packages-and-secrets": {
    c_t50003: "MissingPackage",
    c_t50006: "MissingPackage",
    c_t50013: "EnvNotPublic",
  },
};

/** What a lesson's text says a cell answers. */
const quoted: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "01-first-steps": { c_t10003: "HELLO FROM NODE", c_t10009: 1 },
  "03-typescript": { c_t30006: "fern" },
  "05-packages-and-secrets": { c_t50009: false },
  "06-routes": {
    c_t60007: expect.objectContaining({
      created: 201,
      notes: [expect.anything(), expect.anything()],
    }),
    c_t60012: 500,
  },
  "07-debugging": { c_t70003: 27.1 },
  "09-files-and-git": { c_t90006: "written" },
};

const lessons = async () =>
  (await readdir(lessonsFolder)).filter((file) => file.endsWith(".jsnb")).sort();

let uiDir: string;
beforeAll(async () => {
  uiDir = await mkdtemp(join(tmpdir(), "nimbo-tutorial-page-"));
  if (!browser) return;
  await buildRealmPage(uiDir);
  await buildHeadlessPage(uiDir);
});
afterAll(async () => {
  await rm(uiDir, { recursive: true, force: true });
});

describe("the tutorial's lessons", () => {
  it("are nine, each in the file format's exact form, with no warning and no saved outputs", async () => {
    const files = await lessons();
    expect(files).toHaveLength(9);
    for (const file of files) {
      const text = await readFile(join(lessonsFolder, file), "utf8");
      const parsed = parse(text, { ids: randomIds(), path: file, appVersion: "0.0.0" });
      if (!parsed.ok) throw parsed.error;
      expect(parsed.value.warnings).toEqual([]);
      expect(parsed.value.doc.outputs).toBeUndefined();
      expect(serialize(parsed.value.doc)).toBe(text);
      expect(parsed.value.doc.cells[0]?.source).toMatch(/^# /u);
    }
  });
});

/** Runs `cell` and answers its execution, the run's own error included. */
async function run(daemon: Daemon, notebook: string, cell: string): Promise<Execution> {
  const { execution } = await daemon.client.cell.run({ notebook, cell, timeoutMs: 60_000 });
  return execution;
}

describe(`each lesson run cell by cell${withoutBrowser}`, () => {
  it.each([
    "01-first-steps",
    "02-outputs",
    "03-typescript",
    "04-client-and-bridge",
    "05-packages-and-secrets",
    "06-routes",
    "07-debugging",
    "08-agents",
    "09-files-and-git",
  ])(
    "%s ends every cell as the lesson says",
    async (lesson) => {
      await withDaemon(
        async (daemon) => {
          const { client } = daemon;
          if (browser) await client.settings.set({ key: "realm.headless", value: true });
          const { path } = await client.examples.copy({ name: `tutorial/${lesson}` });
          const { notebook } = await client.notebook.open({ path });
          const code = notebook.cells.filter(
            (cell) => cell.type === "server" || (browser && cell.type === "client"),
          );
          const ended: [string, string, string | undefined][] = [];
          for (const cell of code) {
            const execution = await run(daemon, path, cell.id);
            const error = execution.error?.name;
            ended.push([cell.id, execution.status, error]);
            const said = quoted[lesson]?.[cell.id];
            if (said !== undefined) expect(valueOf(execution)).toEqual(said);
          }
          const expected = code.map((cell): [string, string, string | undefined] => {
            const name = failing[lesson]?.[cell.id];
            return name === undefined ? [cell.id, "ok", undefined] : [cell.id, "error", name];
          });
          expect(ended).toEqual(expected);
          if (lesson === "02-outputs") await outputsLessonQueries(daemon, path);
        },
        { uiDir },
      );
    },
    180_000,
  );
});

/** The queries the outputs lesson asks for answer what its text says, on the daemon. */
async function outputsLessonQueries(daemon: Daemon, notebook: string): Promise<void> {
  const query = (mode: "jq" | "jsonpath", text: string) =>
    daemon.client.cell.outputQuery({ notebook, cell: "c_t20003", index: 0, mode, query: text });
  const jq = await query("jq", 'map(select(.tea == "green")) | map(.cups) | add');
  expect(jq.result.value).toBe(5);
  const paid = await query("jsonpath", '$[?(@.status == "paid")]');
  expect(paid.total).toBe(6);
}
