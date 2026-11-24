// The quality journeys' part for an agent's edit to review, its violet line
// numbers, its card by hover and by the keyboard, the full diff, Mark reviewed from the card and from the Agent view,
// Revert and the editor's undo of it; the bottom panel's Console (filter, level switches, a cell's button, Clear) and
// Activity (a run's and a request's rows, the cell they went to). Each control is used as a user would and the layout
// is checked in the state it leaves (quality.ts).
import type { Locator, Page } from "@playwright/test";

import { agentAdds, cell, cells } from "./cells.js";
import { sound } from "./quality.js";
import type { World } from "./world.js";
import { expect, rest } from "./world.js";

const card = (page: Page): Locator => page.locator('[data-part="agent-card"]');

/** Hovers the first violet line number within `scope` and waits for its card. */
async function hoverMarks(page: Page, scope: Locator): Promise<void> {
  await scope.locator("[data-agent-line]").first().scrollIntoViewIfNeeded();
  await scope.locator("[data-agent-line]").first().hover();
  await expect(card(page)).toBeVisible();
}

/** The card and the full diff of the first agent edit to review on the page, in the layout check. */
export async function agentCard(page: Page, state: string): Promise<void> {
  await hoverMarks(page, page.locator(".jsnb-ui"));
  await sound(page, `the agent edit's card, ${state}`);
  await card(page).getByRole("button", { name: "Open full diff" }).click();
  await expect(page.getByTestId("agent-diff")).toBeVisible();
  await sound(page, `the agent edit's full diff, ${state}`);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("agent-diff")).toHaveCount(0);
  await page.mouse.move(0, 0);
}

/** The card by the keyboard: the cell's button for the edit takes the focus (the first violet number ringed), Enter
 * goes into the card, Escape back. */
async function byKeyboard(page: Page, n: number): Promise<void> {
  const mark = cell(page, n).locator('[data-part="agent-mark"]');
  await mark.focus();
  await expect(card(page)).toBeVisible();
  await expect(cell(page, n).locator(".cm-agentFocus")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(card(page).getByRole("button", { name: "Revert" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(mark).toBeFocused();
}

/**
 * An agent's cell (cell `n`) reviewed from the Agent view; the agent edits it again; the card by the keyboard and by
 * hover; Revert puts the code back and the editor's undo takes the revert back, as the user's edit, so no line is
 * violet any more.
 */
export async function agentEdits(page: Page, world: World, n: number): Promise<void> {
  const id = await agentAdds(world, "server", "const late = 1;\nlate");
  await expect(cell(page, n).locator("[data-agent-line]")).toHaveCount(2);
  await page.getByRole("button", { name: /^Agent/u }).click();
  const row = page
    .getByRole("list", { name: "Agent edits to review" })
    .getByRole("listitem")
    .last();
  await row.hover();
  await sound(page, "the Agent view with its edits to review");
  await row.getByRole("button", { name: /^Mark the edit of cell/u }).click();
  await expect(cell(page, n).locator("[data-agent-line]")).toHaveCount(0);
  await world.jsnb(
    "cell",
    "update",
    "-n",
    "demo.jsnb",
    "--cell",
    id,
    "--source",
    "const late = 2;\nlate",
  );
  await expect(cell(page, n).locator('[data-agent-line="1"]')).toBeVisible();
  await byKeyboard(page, n);
  await agentCard(page, "of an edited line");
  await hoverMarks(page, cell(page, n));
  await card(page).getByRole("button", { name: "Revert" }).click();
  const text = cell(page, n).locator(".cm-content");
  await expect(text).toHaveText(/const late = 1;/u);
  await expect(cell(page, n).locator("[data-agent-line]")).toHaveCount(0);
  await text.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(text).toHaveText(/const late = 2;/u);
  await page.keyboard.press("Escape");
  await rest(page);
  await expect(cell(page, n).locator("[data-agent-line]")).toHaveCount(0);
  await page.getByRole("button", { name: /^Explorer/u }).click();
  await sound(page, "after an agent's edit was reverted and the revert undone");
}

/** Opens the bottom panel's tab `name` (the panel shown first when it is hidden). */
async function tab(page: Page, name: string): Promise<Locator> {
  const bottom = page.getByRole("region", { name: "Panel" });
  if ((await bottom.count()) === 0) await page.keyboard.press("ControlOrMeta+j");
  await bottom.getByRole("tab", { name: new RegExp(`^${name}`, "u") }).click();
  return bottom;
}

/** A cell that prints (cell `n`, added by the agent and run); the Console's filter, level switches, the line's cell
 * and Clear; the Activity log's rows and the cell one went to. */
export async function logs(page: Page, world: World, n: number): Promise<void> {
  await agentAdds(
    world,
    "server",
    'console.log("a line for the Console");\nconsole.warn("and one on stderr");',
  );
  await cell(page, n).getByTestId("run-cell").click();
  await expect(cell(page, n).getByTestId("run-fact")).toHaveAttribute("data-kind", "ok");
  const cellOfLine = n;
  const consoleTab = await tab(page, "Console");
  const lines = consoleTab.getByTestId("console-lines").getByRole("row");
  await expect(lines.first()).toBeVisible();
  await sound(page, "the Console");
  await consoleTab.getByRole("button", { name: "Output", exact: true }).click();
  await consoleTab.getByRole("button", { name: "Output", exact: true }).click();
  await consoleTab.getByTestId("console-filter").fill("no line says this");
  await expect(consoleTab.getByText("No results")).toBeVisible();
  await consoleTab.getByTestId("console-filter").fill("");
  await lines
    .first()
    .getByRole("button", { name: /^Go to cell/u })
    .click();
  await expect(cell(page, cellOfLine)).toHaveAttribute("data-selected", "");
  const activity = await tab(page, "Activity");
  const rows = activity.getByRole("rowgroup", { name: "Activity" }).getByRole("row");
  await expect(rows.filter({ hasText: "cell run" }).first()).toBeVisible();
  await sound(page, "the Activity log");
  await rows
    .filter({ hasText: "cell run" })
    .first()
    .getByRole("button", { name: /: go to the cell$/u })
    .click();
  await (await tab(page, "Console")).getByRole("button", { name: "Clear" }).click();
  await expect(consoleTab.getByTestId("console-lines").getByRole("row")).toHaveCount(0);
}

/** The steps on a notebook that has run: an agent's edit reviewed, reverted and the revert undone, then the logs. */
export async function reviewSteps(page: Page, world: World): Promise<void> {
  await agentEdits(page, world, (await cells(page).count()) + 1);
  await logs(page, world, (await cells(page).count()) + 1);
}
