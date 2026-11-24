// The quality journeys' part for the editor and long results: Alt Z's fold with the name column saying
// what is inside, a long result's footer, Expand, the header stuck over it, Pin to inspector and the hidden inspector's
// pin, the editor's line values, brackets, find row and completion, the caret's place in the status bar, the Search
// view and the keys said in words. Each control is used as a user would and the layout is checked in the state it
// leaves (quality.ts).
import type { Page } from "@playwright/test";

import { agentAdds, cell } from "./cells.js";
import { sound } from "./quality.js";
import type { World } from "./world.js";
import { expect, rest } from "./world.js";

/** Command mode with cell `n` selected and the focus on the cells, so a key reaches the notebook. */
async function onCell(page: Page, n: number): Promise<void> {
  await cell(page, n).locator('[data-part="number"]').click();
  await page.keyboard.press("Escape");
}

/** Cmd K Cmd 0 folds every cell but the selected one, says what is inside each and Folded; again unfolds them. */
export async function foldAll(page: Page, state: string): Promise<void> {
  await onCell(page, 1);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("ControlOrMeta+0");
  await expect(page.getByTestId("folded")).toHaveText("Folded");
  await expect(cell(page, 2).locator('[data-part="about"]')).toContainText(/^\d+ lines?/u);
  await expect(page.getByTestId("folded")).toHaveText("Folded");
  await sound(page, `every cell folded by Cmd K Cmd 0, ${state}`);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("ControlOrMeta+0");
  await expect(page.getByTestId("folded")).toHaveCount(0);
}

/** A long result stops at seven lines with its footer; Expand, the header stuck over it with Fold result and Next
 * cell, the cap again; Pin to inspector, the hidden inspector's pin, and Unpin. */
export async function longResult(page: Page, world: World, n: number): Promise<void> {
  await agentAdds(
    world,
    "server",
    "Array.from({ length: 90 }, (_, i) => ({ i, name: `row ${i}` }))",
  );
  await agentAdds(world, "server", "1 + 1");
  const long = cell(page, n);
  await long.getByTestId("run-cell").click();
  const lines = long.getByTestId("result-lines");
  await expect(lines).toHaveText(/^Lines 1 to [1-7] of \d{2,}, scrolls in place$/u);
  await rest(page);
  await sound(page, "a long result capped at seven lines");
  await long.getByTestId("result-height").click();
  await expect(lines).toHaveText(/^All \d{2,} lines shown\./u);
  // the page scrolls on through the result, as a user would: to its end, the cell's top then above the page's
  await long.evaluate((item) => {
    const scroller = item.closest("#page");
    if (scroller !== null) scroller.scrollTop = scroller.scrollHeight;
  });
  await expect(long.getByTestId("stuck-lines")).toHaveText(/^lines \d+ to \d+ of \d+$/u);
  await sound(page, "a cell header stuck over its expanded result");
  await long.getByRole("button", { name: /^Next cell/u }).click();
  await expect(cell(page, n + 1)).toHaveAttribute("data-selected", "");
  await long.getByTestId("result-height").click();
  await expect(lines).toHaveText(/^Lines 1 to/u);
  await long.getByTestId("pin-result").click();
  await expect(long.locator('[data-part="pinned-here"]')).toContainText(
    "Result pinned to the inspector",
  );
  const pinned = page.locator('#inspector [data-section="pinned"]');
  await expect(pinned.locator('[data-part="output"]')).toBeVisible();
  await sound(page, "a result pinned to the inspector");
  await page.keyboard.press("ControlOrMeta+Alt+b");
  await page.getByTestId("rail-pinned").click();
  await expect(pinned).toBeVisible();
  await pinned.getByRole("button", { name: "Unpin" }).click();
  await expect(long.locator('[data-part="output"]')).toBeVisible();
}

/** Cell `n` (whose first line declares a function and holds brackets) shows no value at the line's end, colours its
 * brackets and says the caret's line and column; Cmd F opens the find row, which steps, toggles and closes; Ctrl
 * Space opens the completion list under the caret, which Esc closes in edit mode. */
export async function editorParts(page: Page, n: number): Promise<void> {
  const code = cell(page, n);
  // a function's value says nothing its declaration does not: its line shows none
  await expect(code.locator(".cm-lineValue")).toHaveCount(0);
  await expect(code.locator(".cm-bracket-1").first()).toBeVisible();
  await code.locator(".cm-line").first().click();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("caret")).toHaveText("Ln 1, Col 1");
  await page.keyboard.press("ControlOrMeta+f");
  const find = code.getByRole("search", { name: "Find in the cell" });
  await page.keyboard.type("n");
  await expect(find.locator(".cm-findCount")).toHaveText(/ of | match/u);
  await find.getByRole("button", { name: "Next match" }).click();
  await find.getByRole("button", { name: "Previous match" }).click();
  await find.getByRole("button", { name: "Match case" }).click();
  await expect(find.getByRole("button", { name: "Match case" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await sound(page, "the find row open under a cell's header");
  await find.getByRole("button", { name: "Close find" }).click();
  await expect(find).toHaveCount(0);
  await code.locator(".cm-line").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Control+Space");
  await expect(code.locator(".cm-tooltip-autocomplete")).toBeVisible();
  await sound(page, "the completion list open");
  await page.keyboard.press("Escape");
  await expect(code.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
  await expect(page.getByTestId("mode")).toHaveAttribute("data-mode", "edit");
  await page.keyboard.press("Escape");
}

/** The Search view finds `text` in the cells and goes to the line clicked; the cell menu says its keys in words. */
export async function searchView(page: Page, text: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("button", { name: /^Search/u })
    .click();
  await page.getByTestId("search-field").fill(text);
  const hit = page.getByTestId("search-hit").first();
  await expect(hit).toBeVisible();
  await sound(page, "the Search view with its matches");
  await hit.click();
  await expect(page.getByTestId("mode")).toHaveAttribute("data-mode", "edit");
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("button", { name: /^Explorer/u })
    .click();
  await cell(page, 1).locator('[data-part="head"]').hover();
  await cell(page, 1).getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: /^Move Up/u })).toContainText(/Alt Up$/u);
  await page.keyboard.press("Escape");
}
