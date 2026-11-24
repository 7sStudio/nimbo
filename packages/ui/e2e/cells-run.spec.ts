// Journey: a user writes and runs cells from the keyboard: the add row's Server button
// adds a cell and selects it, ↩ enters its editor, ⇧↩ runs the last cell and stays on it, the value
// appears under the code with its duration in the header row, and ⌥↩ runs it and edits a new cell of its type below; a
// long cell shows the running block (its state "running" and the elapsed time counting up in the header row, the stop
// square in place of the run button), a second one waits as queued after it, and the square interrupts it. axe runs on
// the idle, running and finished page.
import type { Page } from "@playwright/test";

import { agentAdds, axeClean, cell, cells, runOf, settled } from "./cells.js";
import { viewButton } from "./panels.js";
import { expect, rest, shot, test } from "./world.js";

test("the last cell runs with ⇧↩ and stays, ⌥↩ runs it and edits a new one", async ({
  page,
  world,
}) => {
  await world.open(page);
  await axeClean(page);
  await page
    .getByRole("group", { name: "Add a cell" })
    .getByRole("button", { name: "Server" })
    .click();
  await expect(cells(page)).toHaveCount(1);
  // the add button opens the new cell's editor, as VS Code's + Code does
  await expect(cell(page, 1).getByRole("textbox", { name: "Cell 1 source" })).toBeFocused();
  await page.keyboard.type('({ amount: 2000, currency: "usd", paid: false })');
  // the header names the cell from the store's source, which the draft reaches 300 ms after the last key
  await expect(cell(page, 1).locator('[data-part="name"]')).not.toHaveText("empty");
  await settled(page);
  await shot(page, "typed");

  await page.keyboard.press("Shift+Enter");
  await expect(runOf(page, 1)).toHaveAttribute("data-kind", "ok");
  await expect(cell(page, 1)).toBeFocused();
  await expect(cells(page)).toHaveCount(1);
  await expect(cell(page, 1).locator('[data-part="output"]')).toContainText("3 keys");
  // the cell is the user's own: nothing for the Agent view to review
  await expect(viewButton(page, "Agent")).toHaveAccessibleName("Agent, cells an agent edited");
  await rest(page);
  await settled(page);
  await shot(page, "ran", [runOf(page, 1)]);
  await axeClean(page);

  await page.keyboard.press("Alt+Enter");
  await expect(cells(page)).toHaveCount(2);
  await expect(cell(page, 2)).toHaveAccessibleName(/^Cell 2, server,/u);
  await expect(cell(page, 2).getByRole("textbox", { name: "Cell 2 source" })).toBeFocused();
  await page.keyboard.type("1 + 1");
  // the typed text has reached the daemon and the file: the save state is at rest for the shot
  await expect(page.locator("[data-save]")).toHaveAttribute("data-save", "saved");
  await rest(page);
  await settled(page);
  await shot(page, "inserted", [runOf(page, 1)]);
});

/** B adds a cell under the running one, its editor focused, and ⌘↩ runs it: it waits as queued after cell 1. */
async function queueSecond(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.keyboard.press("B");
  await expect(cell(page, 2).locator(".cm-content")).toBeFocused();
  await page.keyboard.type("1 + 1");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(runOf(page, 2)).toHaveAttribute("data-kind", "queued");
  await expect(cell(page, 2).getByTestId("run-cell")).toHaveAccessibleName("Queued");
}

test("a long cell shows the running block, the next one waits, and the square interrupts", async ({
  page,
  world,
}) => {
  await world.open(page);
  await page
    .getByRole("group", { name: "Add a cell" })
    .getByRole("button", { name: "Server" })
    .click();
  await expect(cell(page, 1).getByRole("textbox", { name: "Cell 1 source" })).toBeFocused();
  await page.keyboard.type("await new Promise(() => {})");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(runOf(page, 1)).toHaveAttribute("data-kind", "running");
  await expect(cell(page, 1).getByTestId("run-cell")).toHaveAccessibleName("Interrupt");
  const elapsed = cell(page, 1).getByTestId("cell-elapsed");
  const seconds = async () => Number.parseFloat((await elapsed.textContent()) ?? "");
  const first = await seconds();
  await expect.poll(seconds).toBeGreaterThan(first);

  await queueSecond(page);
  await page.keyboard.press("Escape");
  await rest(page);
  await settled(page);
  await shot(page, "running", [elapsed, page.getByTestId("kernel-elapsed")]);
  await axeClean(page);

  await cell(page, 1).getByRole("button", { name: "Interrupt" }).click();
  await expect(runOf(page, 1)).toHaveAttribute("data-kind", "interrupted");
  await expect(runOf(page, 2)).toHaveAttribute("data-kind", /^(interrupted|ok)$/u);
  await expect(cell(page, 1).getByTestId("run-cell")).toHaveAccessibleName("Run cell");
  await expect(cell(page, 1).getByTestId("cell-elapsed")).toHaveCount(0);
  await rest(page);
  await shot(page, "interrupted", [runOf(page, 1), runOf(page, 2)]);
});

test("text typed just before ⌘⇧↩ or ⌥⇧↩ is what runs", async ({ page, world }) => {
  await world.open(page);
  await agentAdds(world, "server", "1 + 1");
  await expect(cells(page)).toHaveCount(1);
  const editor = cell(page, 1).getByRole("textbox", { name: "Cell 1 source" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("00");
  await page.keyboard.press("ControlOrMeta+Shift+Enter");
  await expect(cell(page, 1).locator('[data-part="output"]')).toContainText("101");
  await page.keyboard.type("0");
  await page.keyboard.press("Alt+Shift+Enter");
  await expect(cell(page, 1).locator('[data-part="output"]')).toContainText("1001");
  await page.keyboard.press("Escape");
  await rest(page);
  await settled(page);
  await shot(page, "typed-then-run-all", [runOf(page, 1)]);
});
