// Journeys: the file on disk (07-file-format §5, the banners). A folder the daemon cannot write: the "could not
// save" banner, the top bar's save state reading "not saved", ⌘S answered with an error toast, Retry once it can write again. A file changed behind the daemon: the
// "changed on disk" banner, and Reload from disk takes the file's version.
import { cells } from "./cells.js";
import { chmod, writeFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

import { click, expect, rest, shot, test } from "./world.js";

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

test("a file changed on disk is reloaded from its banner", async ({ page, world }) => {
  await world.open(page);
  await world.jsnb("cell", "add", "-n", "demo.jsnb", "--type", "server", "--source", "1");
  await world.jsnb("notebook", "save", "-n", "demo.jsnb");
  await writeFile(world.path("demo.jsnb"), '{"version":1,"cells":[]}\n');
  await world.jsnb("cell", "add", "-n", "demo.jsnb", "--type", "server", "--source", "2");
  await expect(banner(page, "conflict")).toContainText("Changed on disk");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-save", "conflict");
  await expect(cells(page)).toHaveCount(2);
  await shot(page, "conflict");
  await click(page, "Reload from disk");
  await expect(banner(page, "conflict")).toHaveCount(0);
  await expect(page.getByTestId("cell-list")).toBeAttached();
  await expect(cells(page)).toHaveCount(0);
  await shot(page, "reloaded");
});
