// Journey: debugging a server cell as in VS Code: a click left of a line number sets a breakpoint, F5 runs the
// selected cell and it pauses on that TypeScript line (the yellow band, the debug toolbar, Run and Debug open on the
// paused frame with its names), F11 steps into a function another cell defined (the band moves there, the call stack
// shows both cells), Shift F11 steps back out, and F5 continues to the cell's value.
import type { Page } from "@playwright/test";

import { cell, runOf } from "./cells.js";
import { addAndRun, panel } from "./panels.js";
import { expect, shot, test } from "./world.js";

const lib = `function twice(n: number): number {
  const doubled = n * 2;
  return doubled;
}`;
const caller = `const start: number = 20;
const out = twice(start);
out + 1;`;

/** Clicks the breakpoint gutter beside line `line` (1-based) of cell `n`. */
async function clickGutter(page: Page, n: number, line: number): Promise<void> {
  const gutter = await cell(page, n).locator(".cm-breakpoints").boundingBox();
  const row = await cell(page, n)
    .locator(".cm-line")
    .nth(line - 1)
    .boundingBox();
  if (gutter === null || row === null) throw new Error("the gutter or the line is not shown");
  await page.mouse.click(gutter.x + gutter.width / 2, row.y + row.height / 2);
}

/** The text of the line the kernel is paused on, in cell `n`. */
const pausedLine = (page: Page, n: number) => cell(page, n).locator(".cm-debugLine");

test("a breakpoint pauses its cell's run on the TypeScript line; F11 steps into another cell, Shift F11 out, F5 on", async ({
  page,
  world,
}) => {
  await world.open(page);
  await addAndRun(page, world, [
    ["server", lib],
    ["server", caller],
  ]);
  await clickGutter(page, 2, 2);
  await expect(cell(page, 2).locator(".cm-bp")).toHaveCount(2); // the dot, and the gutter's hidden spacer
  await shot(page, "breakpoint", [runOf(page, 1), runOf(page, 2)]);

  await cell(page, 2).locator('[data-part="number"]').click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("F5");
  await expect(pausedLine(page, 2)).toHaveText("const out = twice(start);");
  await expect(page.getByTestId("debug-toolbar")).toBeVisible();
  const view = panel(page, "Run and Debug");
  await expect(view.getByRole("list", { name: "Variables" })).toContainText(/start\s*:\s*20/u);
  await shot(page, "paused", [runOf(page, 1), runOf(page, 2)]);

  await page.keyboard.press("F11");
  await expect(pausedLine(page, 1)).toHaveText("  const doubled = n * 2;");
  await expect(view.getByRole("list", { name: "Call Stack" }).getByRole("listitem")).toHaveCount(2);
  await expect(view.getByRole("list", { name: "Variables" })).toContainText(/n\s*:\s*20/u);
  await shot(page, "stepped-in", [runOf(page, 1), runOf(page, 2)]);

  await page.keyboard.press("Shift+F11");
  await expect(pausedLine(page, 2)).toHaveCount(1);
  await page.keyboard.press("F5");
  await expect(runOf(page, 2)).toHaveAttribute("data-kind", "ok");
  await expect(cell(page, 2).locator('[data-part="output"]')).toContainText("41");
  await expect(page.getByTestId("debug-toolbar")).toHaveCount(0);
});
