// Journey: every control does something sensible and nothing throws. On a notebook
// that has run, each icon of the icon bar opens its view and hides it again, each switch of the top bar and each key
// (⌘B, ⌘I, ⌘J) shows and hides its region, each grip is dragged, moved with the keyboard and reset by a double click,
// the tabs, the inspector's groups and their links are used, a cell's header is used end to end (run, type, menu, fold,
// move), the outline and the jump list go to a cell, the status bar's items open their places and the theme switches.
// Then a rendered markdown cell's Edit and Render, the note that Esc
// gives the keys back, N for the values view and W for the fold, O and the row that shows hidden outputs again, a
// syntax error's block with its caret and Jump, an error's Details with its folded Node frames opened, Run again and
// Copy error, and "Switch this cell to client" said once (quality-notes.ts); a route cell's requests
// with Copy URL, a markdown cell's fold, a selection that tints the text alone, the bottom panel as tall as its tab,
// and Run all stopped at a failure saying "not run" in the cells after it; then (quality-editor.ts)
// the editor's line values, brackets, find row and completion, the caret's place, the Search view, the keys in words,
// a long result capped, expanded under a stuck header, pinned to the inspector and unpinned, and Alt Z's fold in both
// themes; then (quality-review.ts) an agent's edit reviewed from the Agent view, its card by the
// keyboard and by hover in both themes, the full diff, Revert and the editor's undo of it, the Console and Activity;
// and those of Home (quality-home.ts): the search field and its keys, a folder picked and folded, F2's rename,
// Delete's confirm, the two panels, the palette, the theme, Stop, a double click that opens and New notebook with Cmd
// Enter. The layout holds after each part (no icon squeezed among them) and no error reaches the console.
import type { Locator, Page } from "@playwright/test";

import { agentAdds, cell, cells, runOf } from "./cells.js";
import { addAndRun } from "./panels.js";
import {
  failures,
  markdownFold,
  notes,
  routeRequests,
  selection,
  stopped,
} from "./quality-notes.js";
import { sound, watchErrors } from "./quality.js";
import { editorParts, foldAll, longResult, searchView } from "./quality-editor.js";
import { homeControls } from "./quality-home.js";
import { agentCard, reviewSteps } from "./quality-review.js";
import { expect, rest, setTheme, test, toasts } from "./world.js";

const button = (page: Page, name: string | RegExp): Locator =>
  page.getByRole("button", { name, exact: typeof name === "string" });
const side = (page: Page, title: string): Locator =>
  page.getByRole("complementary", { name: title });
const width = async (page: Page, id: string): Promise<number> =>
  (await page.locator(`#${id}`).boundingBox())?.width ?? 0;
const height = async (page: Page, id: string): Promise<number> =>
  (await page.locator(`#${id}`).boundingBox())?.height ?? 0;

/** Each icon opens its view; a click on the active one hides the panel, and the next click shows it again. */
async function iconBar(page: Page): Promise<void> {
  const views = [
    [/^Environment/u, "Environment"],
    [/^Agent/u, "Agent"],
    [/^Explorer/u, "Explorer"],
  ] as const;
  for (const [icon, title] of views) {
    await button(page, icon).click();
    await expect(side(page, title)).toBeVisible();
  }
  await button(page, /^Explorer/u).click();
  await expect(page.locator("#side")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("button", { name: "Go to cell 2" })
    .click();
  await expect(cell(page, 2)).toHaveAttribute("data-selected", "");
  await button(page, /^Explorer/u).click();
  await side(page, "Explorer")
    .getByRole("list", { name: "Outline" })
    .getByRole("button")
    .first()
    .click();
  await expect(cell(page, 1)).toHaveAttribute("data-selected", "");
  await sound(page, "after the icon bar");
}

/** Each region hides from its own icon (the focus going to what shows it again: the activity bar's icon, the inspector's
 * rail, the status bar's Problems) and shows again from its key; the hidden inspector's icons open it. */
async function regions(page: Page): Promise<void> {
  const each = [
    ["b", "#side", "side"],
    ["Alt+b", "#inspector", "inspector"],
    ["j", "#bottom", "bottom"],
  ] as const;
  await page.getByTestId("status-problems").click();
  // the status bar's Problems opens the Problems tab, and the panel keeps one height whatever its tab shows
  await expect(page.getByRole("tab", { name: /^Problems/u })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const tall = await height(page, "bottom");
  await page.getByRole("tab", { name: /^Console/u }).click();
  expect(await height(page, "bottom")).toBe(tall);
  for (const [key, region, id] of each) {
    await expect(page.locator(region)).toBeVisible();
    await page.locator(region).getByRole("button", { name: /^Hide/u }).click();
    await expect(page.locator(region)).toHaveCount(0);
    await expect(page.locator(`[data-switch="${id}"]`)).toBeFocused();
    await page.keyboard.press(`ControlOrMeta+${key}`);
    await expect(page.locator(region)).toBeVisible();
  }
  await page.keyboard.press("ControlOrMeta+Alt+b");
  await button(page, /^Routes,/u).click();
  await expect(side(page, "Inspector").getByRole("list", { name: "Routes" })).toBeVisible();
  await sound(page, "after hiding and showing every region");
}

/** A grip is dragged, moved by the arrow keys and reset by a double click. */
async function grips(page: Page): Promise<void> {
  const sideGrip = page.getByTestId("grip-side");
  const box = await sideGrip.boundingBox();
  const before = await width(page, "side");
  await page.mouse.move((box?.x ?? 0) + 2, (box?.y ?? 0) + 200);
  await page.mouse.down();
  await page.mouse.move((box?.x ?? 0) + 82, (box?.y ?? 0) + 200, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => width(page, "side")).toBeGreaterThan(before + 60);
  await sideGrip.dblclick();
  await expect.poll(() => width(page, "side")).toBeCloseTo(before, 0);

  const inspector = await width(page, "inspector");
  await page.getByTestId("grip-inspector").focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => width(page, "inspector")).toBeGreaterThan(inspector + 10);
  await page.keyboard.press("Enter");
  await expect.poll(() => width(page, "inspector")).toBeCloseTo(inspector, 0);

  const bottom = await height(page, "bottom");
  await page.getByTestId("grip-bottom").focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => height(page, "bottom")).toBeGreaterThan(bottom + 10);
  await page.getByTestId("grip-bottom").dblclick();
  await expect.poll(() => height(page, "bottom")).toBeCloseTo(bottom, 0);
  await sound(page, "after the grips");
}

/** The bottom panel's tabs, the inspector's switch and links, and the status bar's items. */
async function panels(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Kernel log" }).click();
  await expect(page.getByTestId("log-path")).toBeVisible();
  await page.getByRole("tab", { name: /^Problems/u }).click();
  await page.getByRole("list", { name: "Errors" }).getByRole("button").click();
  await expect(cell(page, 4)).toHaveAttribute("data-selected", "");
  const inspector = side(page, "Inspector");
  await inspector.getByRole("button", { name: "Client", exact: true }).click();
  await inspector.getByRole("button", { name: "Server", exact: true }).click();
  await inspector
    .getByRole("list", { name: "Exports" })
    .getByRole("button", { name: "Go to cell 1" })
    .click();
  await expect(cell(page, 1)).toHaveAttribute("data-selected", "");
  await inspector.getByRole("button", { name: /^Copy URL/u }).click();
  await expect(toasts(page, "Copied")).toBeVisible();
  await page.getByTestId("kernel-node").click();
  await expect(page.getByRole("region", { name: "Settings" })).toBeVisible();
  await page.getByTestId("settings-close").click();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("region", { name: "Keyboard Shortcuts" })).toBeVisible();
  await page.getByTestId("keybindings-close").click();
  await expect(page.getByRole("region", { name: "Keyboard Shortcuts" })).toHaveCount(0);
  await page.getByTestId("kernel-state").click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await sound(page, "after the panels and the status bar");
}

/** One cell's header end to end: type menu, cell menu, fold and unfold, move down and back, run. */
async function header(page: Page): Promise<void> {
  const second = cell(page, 2);
  await second.getByTestId("type-chip").click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await second.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await second.getByRole("button", { name: "Fold the cell to this row" }).click();
  await expect(second.locator('[data-part="editor"]')).toHaveCount(0);
  await second.getByRole("button", { name: "Unfold the cell" }).click();
  await expect(second.locator('[data-part="editor"]')).toBeVisible();
  await second.getByRole("button", { name: "Move down" }).click();
  await expect(cell(page, 3)).toHaveAttribute("data-selected", "");
  await cell(page, 3).getByRole("button", { name: "Move up" }).click();
  await expect(cell(page, 2)).toHaveAttribute("data-selected", "");
  await second.getByTestId("run-cell").click();
  await expect(second.getByTestId("run-fact")).toHaveAttribute("data-kind", "ok");
  await rest(page);
  await sound(page, "after a cell's header");
}

/** Alt Z's fold in the light theme, then the dark theme with an agent edit's card and the fold again. */
async function themes(page: Page): Promise<void> {
  await foldAll(page, "in the light theme");
  await setTheme(page, "Dark");
  await sound(page, "in the dark theme");
  await agentCard(page, "in the dark theme");
  await foldAll(page, "in the dark theme");
}

test("every control does something sensible, the layout holds and nothing throws", async ({
  context,
  page,
  world,
}) => {
  test.setTimeout(120_000); // ten cells through the CLI, every control of the page and of Home: a hang guard
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors = watchErrors(page);
  await world.open(page);
  await addAndRun(page, world, [
    ["server", "export const double = (n: number) => n * 2;"],
    ["server", 'route("GET /ping", () => "pong");'],
    ["client", "const four = await double(2);\nfour"],
  ]);
  await agentAdds(world, "server", "missing.name");
  await cell(page, 4).getByTestId("run-cell").click();
  await expect(runOf(page, 4)).toHaveAttribute("data-kind", "error");
  await routeRequests(page, world);
  await iconBar(page);
  await regions(page);
  await grips(page);
  await panels(page);
  await header(page);
  await notes(page, world);
  await markdownFold(page);
  await selection(page);
  await failures(page, world);
  await stopped(page);
  await editorParts(page, 1);
  await searchView(page, "double");
  await longResult(page, world, (await cells(page).count()) + 1);
  await reviewSteps(page, world);
  await themes(page);
  await homeControls(page, world);
  errors.none();
});
