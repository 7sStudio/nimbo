// Journey: a run that throws: the cell's state says it
// failed and at which line, the error shows under the code as Jupyter prints it (its name and message, the line
// that threw quoted with its number, marked in the gutter), the rest behind Details, the live line announces it, Copy
// error writes the stack, and the frame's Jump selects the cell that threw, here another cell than the one that ran.
import type { Locator, Page } from "@playwright/test";

import { axeClean, agentAdds, cell, cells, runOf, settled } from "./cells.js";
import { click, expect, rest, shot, test, toasts } from "./world.js";

/** The block says what went wrong in words, the message plainly and the line that threw, marked in the gutter. */
async function saysWhatWentWrong(page: Page, error: Locator): Promise<void> {
  await expect(error.locator('[data-part="error-title"]')).toHaveText(
    "RangeError: amount below zero",
  );
  await expect(error.locator('[data-part="error-line"]')).toHaveText("Line 1charge(-1)");
  await expect(cell(page, 2).locator(".cm-lineNumbers .cm-gutterElement.cm-failedLine")).toHaveText(
    "1",
  );
}

/** Copy error writes the stack as the user reads it, and its toast says so. */
async function copiesTheError(page: Page, error: Locator): Promise<void> {
  await error.getByTestId("copy-error").click();
  await expect(toasts(page, "Copied the error")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /^RangeError: amount below zero/u,
  );
  await page.getByRole("button", { name: "Dismiss" }).click();
}

test("a thrown error shows its stack and Jump goes to the cell that threw", async ({
  context,
  page,
  world,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await world.open(page);
  await agentAdds(
    world,
    "server",
    'export function charge(amount) {\n  if (amount < 0) throw new RangeError("amount below zero");\n  return amount;\n}',
  );
  await agentAdds(world, "server", "charge(-1)");
  await expect(cells(page)).toHaveCount(2);
  await click(page, "Run All");
  await expect(runOf(page, 2)).toHaveAttribute("data-kind", "error");
  // the line is the cell's own, where it called charge: the throw two frames up is cell 1's line 2
  await expect(page.getByTestId("announcer")).toHaveText("Cell 2 failed: RangeError");
  await expect(cell(page, 2)).toHaveAccessibleName("Cell 2, server, error");
  const error = cell(page, 2).locator('[data-part="run-error"]');
  await saysWhatWentWrong(page, error);
  const clocks = [runOf(page, 1), runOf(page, 2)];
  await rest(page);
  await settled(page);
  await shot(page, "error", clocks);
  await axeClean(page);
  await copiesTheError(page, error);
  const details = error.getByRole("button", { name: /^Details/u });
  await details.click();
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await error.getByRole("button", { name: /Jump/u }).first().click();
  await expect(cell(page, 1)).toHaveAttribute("data-selected", "");
  await rest(page);
  await shot(page, "jumped", clocks);
});
