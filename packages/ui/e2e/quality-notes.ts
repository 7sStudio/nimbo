// The quality journey's part for the cells' smaller controls: each is used as a user would and the layout is checked in the state it leaves. e2e/quality-controls.spec.ts runs both after a cell's
// header, on its notebook of four cells (the third a client cell that printed a value).
import type { Page } from "@playwright/test";

import { agentAdds, cell, runOf } from "./cells.js";
import { sound } from "./quality.js";
import type { World } from "./world.js";
import { expect, rest, toasts } from "./world.js";

/** A rendered markdown cell's Edit and Render, the editing note, and the keys N, W and O on a cell that ran. */
export async function notes(page: Page, world: World): Promise<void> {
  await agentAdds(world, "markdown", "# Notes\n\nA paragraph.");
  const prose = cell(page, 5);
  await prose.getByRole("heading", { name: "Notes" }).hover();
  await prose.getByRole("button", { name: "Edit" }).click();
  await expect(prose.getByRole("textbox", { name: "Cell 5 source" })).toBeFocused();
  await sound(page, "while a markdown cell is edited");
  await prose.getByRole("button", { name: "Render" }).click();
  await expect(prose.getByRole("heading", { name: "Notes" })).toBeVisible();

  const third = cell(page, 3);
  await third.locator(".cm-content").click();
  await sound(page, "while a code cell is edited");
  await page.keyboard.press("Escape");
  await page.keyboard.press("N");
  await expect(third.getByRole("region", { name: "Values" })).toBeVisible();
  await page.keyboard.press("N");
  await expect(third.getByRole("region", { name: "Values" })).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(third.getByRole("button", { name: "Unfold the cell" })).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("O");
  const hidden = third.getByRole("button", { name: /^Show the outputs/u });
  await expect(hidden).toContainText("1 output hidden, O shows them");
  await sound(page, "with a cell's outputs hidden");
  await hidden.click();
  await expect(third.locator('[data-part="output"]')).toBeVisible();
}

/** Dismisses every toast on the page, the newest first. */
async function dismissAll(page: Page): Promise<void> {
  const dismiss = page.getByRole("button", { name: "Dismiss" });
  while ((await dismiss.count()) > 0) await dismiss.last().click();
}

/** A rendered markdown cell folds to its header and back from its own arrow. */
export async function markdownFold(page: Page): Promise<void> {
  const prose = cell(page, 5);
  await prose.locator('[data-part="head"]').hover();
  await prose.getByRole("button", { name: "Fold the cell to this row" }).click();
  await expect(prose.getByRole("heading", { name: "Notes" })).toHaveCount(0);
  await expect(prose.locator('[data-part="about"]')).toHaveText("3 lines of prose");
  await sound(page, "with a markdown cell folded");
  await prose.getByRole("button", { name: "Unfold the cell" }).click();
  await expect(prose.getByRole("heading", { name: "Notes" })).toBeVisible();
}

/** A selection of a whole line and its line break tints the text and a half character after it, never the row out to
 * the editor's right edge. */
export async function selection(page: Page): Promise<void> {
  const third = cell(page, 3);
  await third.locator(".cm-line").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowDown");
  // the layer is drawn in CodeMirror's next measure: its marks are waited for, then measured
  await expect(third.locator(".cm-lineBreakSelection")).toHaveCount(1);
  const right = await third
    .locator(".cm-content")
    .evaluate((el) => el.getBoundingClientRect().right);
  const ends = await third
    .locator(".cm-textSelection, .cm-lineBreakSelection")
    .evaluateAll((marks) => marks.map((mark) => mark.getBoundingClientRect().right));
  expect(ends.length).toBeGreaterThan(1);
  expect(Math.max(...ends)).toBeLessThan(right - 200);
  await page.keyboard.press("Escape");
}

/** A route cell's result is its requests: the count, the address, Copy URL and one row per request, never the
 * disposer route() returns. */
export async function routeRequests(page: Page, world: World): Promise<void> {
  expect(await (await fetch(`${world.origin}/n/demo/ping`)).text()).toBe("pong");
  const requests = cell(page, 2).locator('[data-part="route-requests"]');
  await expect(requests.locator('[data-part="hits"]')).toHaveText("1 request");
  await expect(requests.locator('[data-part="request"]')).toContainText(["200"]);
  await expect(cell(page, 2).locator('[data-part="output"]')).toHaveCount(0);
  await requests.getByRole("button", { name: "Copy URL of GET /ping" }).click();
  await expect(toasts(page, "Copied the URL")).toBeVisible();
  await dismissAll(page);
  await sound(page, "with a route's requests");
}

/** A syntax error's block with its caret and Jump, a run error's words, Copy error and Details with its folded Node
 * frames opened, and the switch to client said once. */
export async function failures(page: Page, world: World): Promise<void> {
  await agentAdds(world, "server", "const x = ;");
  await cell(page, 6).getByTestId("run-cell").click();
  const block = cell(page, 6).locator('[data-part="run-error"]');
  await expect(block.locator('[data-part="error-excerpt"]')).toContainText("const x = ;");
  await expect(cell(page, 6).locator(".cm-lineNumbers .cm-gutterElement.cm-failedLine")).toHaveText(
    "1",
  );
  await block.getByRole("button", { name: "Jump" }).click();
  await expect(cell(page, 6)).toHaveAttribute("data-selected", "");

  await agentAdds(world, "server", '(await import("node:fs")).readFileSync("/no/such/file")');
  const seventh = cell(page, 7);
  await seventh.getByTestId("run-cell").click();
  const thrown = seventh.locator('[data-part="run-error"]');
  await expect(thrown.locator('[data-part="error-name"]')).toHaveText("Error");
  await expect(thrown.locator('[data-part="error-message"]')).toContainText("/no/such/file");
  await thrown.getByTestId("copy-error").click();
  await expect(toasts(page, "Copied the error")).toBeVisible();
  await dismissAll(page);
  await thrown.getByRole("button", { name: /^Details/u }).click();
  const frames = seventh.getByRole("button", { name: /internal Node frame/u });
  await frames.click();
  await expect(frames).toHaveAttribute("aria-expanded", "true");
  await expect(seventh.locator('ol ol[data-part="frames"]')).toBeVisible();
  await sound(page, "with an error's Details open");
  await seventh.getByTestId("run-cell").click();
  await expect(runOf(page, 7)).toHaveAttribute("data-kind", "error");

  await agentAdds(world, "server", "four");
  const eighth = cell(page, 8);
  await eighth.getByTestId("run-cell").click();
  await expect(eighth.getByTestId("switch-hint")).toHaveText("Enter switches it to client");
  await expect(eighth.getByTestId("switch-to-client")).toHaveCount(1);
  await expect(eighth).not.toContainText(/c_[0-9a-z]{6}/u);
  await rest(page);
  await sound(page, "with a syntax error and a name a client cell defines");
  await eighth.getByTestId("switch-to-client").click();
  await expect(eighth).toHaveAccessibleName(/^Cell 8, client,/u);
  await expect(eighth.getByTestId("switch-to-client")).toHaveCount(0);
  await sound(page, "after the switch to client");
}

/** Run all stops at the first cell that fails: the cells after it were not run, and say nothing about it. */
export async function stopped(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Run All", exact: true }).click();
  await expect(runOf(page, 6)).toHaveAttribute("data-kind", "notRun");
  await sound(page, "after Run all stopped at a failure");
}
