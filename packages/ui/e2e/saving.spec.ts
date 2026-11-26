// Journeys: the file on disk (the banners). A folder the daemon cannot write: the "could not
// save" banner, the top bar's save state reading "not saved", ⌘S answered with an error toast, Retry once it can write again. A file changed behind the daemon: merged
// in place with its toast; the same cell changed here too: the "changed on disk" banner, Compare, and Reload from disk
// takes the file's version. Typing while the daemon is stalled: the drafts in flight chain, so no conflict.
import { cell, cells } from "./cells.js";
import { chmod, readFile, writeFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

import { click, expect, field, rest, shot, test } from "./world.js";

const banner = (page: Page, id: string) => page.locator(`[data-banner="${id}"]`);

test("a failed save shows its banner, ⌘S says why, and Retry saves", async ({ page, world }) => {
  await world.open(page);
  await chmod(world.dir, 0o555);
  try {
    await world.jsnb("cell", "add", "-n", "demo.jsnb", "--type", "server", "--source", "1");
    await expect(banner(page, "saveFailed")).toContainText("Could not save");
    await expect(page.getByTestId("save-state")).toHaveAttribute("data-save", "failed");
    await shot(page, "save-failed");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("status").filter({ hasText: "SaveFailed" })).toBeVisible();
    await rest(page);
    await shot(page, "save-failed-toast");
  } finally {
    await chmod(world.dir, 0o755);
  }
  await banner(page, "saveFailed").getByRole("button", { name: "Retry" }).click();
  await expect(banner(page, "saveFailed")).toHaveCount(0);
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-save", "saved");
});

/** The demo notebook's file with the source line `from` (a one-line cell) made `to`, as an editor would write it. */
async function editOnDisk(path: string, from: string, to: string): Promise<void> {
  const text = await readFile(path, "utf8");
  if (!text.includes(JSON.stringify(from))) throw new Error(`no line ${from} in the file`);
  await writeFile(path, text.replace(JSON.stringify(from), JSON.stringify(to)));
}

test("an edit on disk updates the page in place", async ({ page, world }) => {
  await world.open(page);
  await world.jsnb("cell", "add", "-n", "demo.jsnb", "--type", "server", "--source", "1");
  await world.jsnb("notebook", "save", "-n", "demo.jsnb");
  await editOnDisk(world.path("demo.jsnb"), "1", "40 + 2");
  await expect(
    page.getByRole("status").filter({ hasText: "Updated from disk: 1 cell" }),
  ).toBeVisible();
  await expect(cells(page).first()).toContainText("40 + 2");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-save", "saved");
  await rest(page);
  await shot(page, "updated-from-disk");
});

test("the same cell changed on disk and here is a conflict, reloaded from its banner", async ({
  page,
  world,
}) => {
  await world.open(page);
  await world.jsnb("config", "set", "files.autoSave", "off");
  const added = await world.jsnb(
    "cell",
    "add",
    "-n",
    "demo.jsnb",
    "--type",
    "server",
    "--source",
    "1",
  );
  const cell = field(added, "cell", "id");
  await world.jsnb("notebook", "save", "-n", "demo.jsnb");
  await world.jsnb("cell", "update", "-n", "demo.jsnb", "--cell", cell, "--source", "2");
  await editOnDisk(world.path("demo.jsnb"), "1", "3");
  await expect(banner(page, "conflict")).toContainText("Changed on disk");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-save", "conflict");
  await expect(cells(page).first()).toContainText("2");
  await shot(page, "conflict");
  await click(page, "Compare");
  await expect(page.getByTestId("diff-page")).toContainText("On Disk");
  await page.getByTestId("diff-close").click();
  await click(page, "Reload from disk");
  await expect(banner(page, "conflict")).toHaveCount(0);
  await expect(cells(page).first()).toContainText("3");
  await shot(page, "reloaded");
});

/** Runs `work` with the daemon's process stopped (SIGSTOP), then lets it go on. */
async function stalled(world: { path: (...parts: string[]) => string }, work: () => Promise<void>) {
  const { pid } = JSON.parse(await readFile(world.path(".jsnb", "server.json"), "utf8")) as {
    pid: number;
  };
  process.kill(pid, "SIGSTOP");
  try {
    await work();
  } finally {
    process.kill(pid, "SIGCONT");
  }
}

test("typing while the daemon is stalled sends drafts that chain, never a conflict", async ({
  page,
  world,
}) => {
  test.setTimeout(30_000);
  await world.open(page);
  const added = await world.jsnb(
    "cell",
    "add",
    "-n",
    "demo.jsnb",
    "--type",
    "server",
    "--source",
    "1",
  );
  const id = field(added, "cell", "id");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-save", "saved");
  await cell(page, 1).getByRole("textbox", { name: "Cell 1 source" }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await stalled(world, async () => {
    // each key past the draft delay: a draft each, all in flight
    for (let key = 0; key < 12; key += 1) {
      await page.keyboard.type("0");
      await page.waitForTimeout(450);
    }
  });
  await expect
    .poll(async () =>
      field(await world.jsnb("cell", "get", "-n", "demo.jsnb", "--cell", id), "cell", "source"),
    )
    .toBe(`1${"0".repeat(12)}`);
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-save", "saved");
  const state = await world.jsnb("notebook", "get", "-n", "demo.jsnb");
  expect(JSON.stringify(state)).not.toContain('"conflict":{');
  await expect(banner(page, "conflict")).toHaveCount(0);
});
