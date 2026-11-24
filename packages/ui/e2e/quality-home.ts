// The Home page's part of the two quality journeys. Reached from
// the notebook page's File > Home like a user: the cursor in the search field, a title word finding a notebook in a
// folder, Up and Down, Escape clearing; the Explorer's tree folded at first, a folder unfolded and picked to narrow the
// list; F2's rename, the right-click menu's Rename and Delete, Rename's confirm on an open notebook; the Explorer hidden
// and shown by its icon, its key and the activity bar, its grip; the palette, Stop in Running, a double click opening a
// notebook, New Notebook and Cmd Enter creating one, and the theme from the gear; and the same page holding its layout
// with long names and the Explorer at its widest and narrowest and hidden, in both themes. The layout is checked at
// each step (quality.ts homeSound).
import type { Locator, Page } from "@playwright/test";

import { picker } from "./quality-folders.js";
import { homeSound } from "./quality.js";
import type { World } from "./world.js";
import { expect } from "./world.js";

const option = (page: Page, path: string): Locator =>
  page.locator(`[role="option"][data-path="${path}"]`);
const treeRow = (page: Page, key: string): Locator =>
  page.getByRole("tree").locator(`[role="treeitem"][data-key="${key}"]`);
const width = async (page: Page, id: string): Promise<number> =>
  (await page.locator(`#${id}`).boundingBox())?.width ?? 0;

/** A closed notebook at `path` whose cells the agent wrote. */
async function closedNotebook(
  world: World,
  path: string,
  cells: readonly (readonly [type: string, source: string])[],
): Promise<void> {
  await world.jsnb("notebook", "create", "--path", path);
  for (const [type, source] of cells)
    await world.jsnb("cell", "add", "-n", path, "--type", type, "--source", source);
  await world.jsnb("notebook", "close", "-n", path);
}

/** A theme picked from the gear's Theme menu. */
async function theme(page: Page, name: "Light" | "Dark"): Promise<void> {
  await page.locator('[data-rail="settings"]').click();
  await page.getByRole("menuitem", { name: "Theme" }).click();
  await page.getByRole("menuitem", { name }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", name.toLowerCase());
}

/** Home from the notebook page's File menu, once its list and the summaries it searches have loaded. */
async function toHome(page: Page, count: number): Promise<void> {
  await page.locator('[data-menu="File"]').click();
  await page.getByRole("menuitem", { name: "Go to Home" }).click();
  await expect(page.getByTestId("summary")).toContainText(`${String(count)} notebooks`);
  await expect(page.getByTestId("row-cells").filter({ hasText: /^$/u })).toHaveCount(0);
}

/** The Explorer hides and shows from its own icon, its key and the activity bar; the grip drags and resets. */
async function explorer(page: Page): Promise<void> {
  await page.locator("#side").getByRole("button", { name: "Hide Explorer" }).click();
  await expect(page.locator("#side")).toHaveCount(0);
  await expect(page.locator('[data-rail="explorer"]')).toBeFocused();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(page.locator("#side")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+b");
  await page.locator('[data-rail="explorer"]').click();
  await expect(page.locator("#side")).toBeVisible();
  const grip = page.getByTestId("grip-side");
  const box = await grip.boundingBox();
  const before = await width(page, "side");
  await page.mouse.move((box?.x ?? 0) + 2, (box?.y ?? 0) + 200);
  await page.mouse.down();
  await page.mouse.move((box?.x ?? 0) + 62, (box?.y ?? 0) + 200, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => width(page, "side")).toBeGreaterThan(before + 40);
  await grip.dblclick();
  await expect.poll(() => width(page, "side")).toBeCloseTo(before, 0);
}

/** The search field: a title word finds the notebook in its folder, Up and Down move, Escape clears. */
async function search(page: Page): Promise<void> {
  const field = page.getByTestId("search");
  await expect(field).toBeFocused();
  await field.fill("quarter");
  await expect(option(page, "reports/q4.jsnb")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("create-row")).toContainText("quarter.jsnb");
  await field.press("ArrowDown");
  await field.press("ArrowUp");
  await expect(option(page, "reports/q4.jsnb")).toHaveAttribute("aria-selected", "true");
  await homeSound(page, "Home, searching");
  await field.press("Escape");
  await expect(field).toHaveValue("");
}

/** The Explorer's tree: folders folded at first, one unfolded and picked narrows the list, picked again shows all. */
async function tree(page: Page): Promise<void> {
  await expect(treeRow(page, "reports/q4.jsnb")).toHaveCount(0);
  await treeRow(page, "reports/").click();
  await expect(treeRow(page, "reports/q4.jsnb")).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByTestId("folder-filter")).toContainText("reports/");
  await homeSound(page, "Home, a folder picked in the tree");
  await page.getByTestId("folder-filter").click();
  await expect(page.getByRole("option")).toHaveCount(2);
}

/** F2 renames the selected row and gives the focus back to the field; the right-click menu's Rename renames in the
 * tree and its Delete asks, Cancel keeping the file; Rename on the open notebook asks first, and Cancel keeps it open. */
async function files(page: Page): Promise<void> {
  await option(page, "reports/q4.jsnb").click();
  await page.keyboard.press("F2");
  const field = page.getByTestId("rename-field");
  await expect(field).toBeFocused();
  await homeSound(page, "Home, renaming");
  await field.fill("reports/q5.jsnb");
  await field.press("Enter");
  await expect(option(page, "reports/q5.jsnb")).toBeVisible();
  await expect(page.getByTestId("search")).toBeFocused();
  await treeRow(page, "reports/q5.jsnb").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await expect(page.locator("#side").getByTestId("rename-field")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(treeRow(page, "reports/q5.jsnb")).toBeFocused();
  await option(page, "reports/q5.jsnb").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete reports/q5.jsnb?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  // an open notebook is renamed in place too: it follows its file, its kernel running on
  await option(page, "demo.jsnb").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await expect(page.getByTestId("rename-field")).toBeFocused();
  await homeSound(page, "Home, renaming an open notebook");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("running").locator('li[data-path="demo.jsnb"]')).toBeAttached();
}

/** Home's controls, from the notebook page `demo.jsnb` of `world`; it ends on a new notebook's page. */
export async function homeControls(page: Page, world: World): Promise<void> {
  await closedNotebook(world, "reports/q4.jsnb", [
    ["markdown", "# Quarter four\n\nRevenue by week."],
  ]);
  await toHome(page, 2);
  await homeSound(page, "Home, the notebook just left still open");
  await search(page);
  await tree(page);
  await files(page);
  await explorer(page);
  await homeSound(page, "Home after its Explorer moved");
  await picker(page, world);
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await expect(page.getByLabel("Commands and cells")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Commands and cells")).toHaveCount(0);
  await theme(page, "Light");
  await homeSound(page, "Home in the light theme");
  await page.locator('[data-section="running"] h3').hover();
  await page.getByTestId("running").locator('li[data-path="demo.jsnb"]').hover();
  await page.getByTestId("stop-demo.jsnb").click();
  await expect(page.getByTestId("running").locator("li")).toHaveCount(0);
  await option(page, "demo.jsnb").dblclick();
  await expect(page).toHaveURL(/\/ui\/demo\?token=/u);
  await expect(page.getByTestId("kernel-state")).toHaveAttribute("data-state", "idle");
  await page.goBack();
  await page.getByTestId("new-notebook").click();
  await expect(page.getByTestId("search")).toBeFocused();
  await expect(page.getByTestId("search")).toHaveAttribute("placeholder", "New notebook name");
  await page.keyboard.type("weekly");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page).toHaveURL(/\/ui\/weekly\?token=/u);
}

/** Home with long names: the rows, the tree unfolded, a search, the Explorer at its widest and narrowest and hidden,
 * in the page's theme as it is and in the other one. */
export async function homeLayout(page: Page, world: World, longName: string): Promise<void> {
  const folder = "reports-with-a-folder-name-long-enough-to-be-cut";
  const path = `${folder}/and-a-subfolder/${longName}-weekly.jsnb`;
  await closedNotebook(world, path, [
    ["markdown", "# A long title\nA paragraph of text."],
    ["server", `export const ${longName} = 1;`],
    [
      "server",
      'route("POST /webhook/stripe/events/with/a/long/path/segment", () => ({ ok: true }));',
    ],
  ]);
  await toHome(page, 3);
  await treeRow(page, `${folder}/`).click();
  await treeRow(page, `${folder}/and-a-subfolder/`).click();
  await treeRow(page, path).click();
  await expect(option(page, path)).toHaveAttribute("aria-selected", "true");
  await homeSound(page, "Home with long names");
  await page.getByTestId("search").fill(longName.slice(0, 12));
  await expect(option(page, path)).toHaveAttribute("aria-selected", "true");
  await homeSound(page, "Home searching a long export");
  for (const key of ["End", "Home"]) {
    await page.getByTestId("grip-side").focus();
    await page.keyboard.press(key);
    await homeSound(page, key === "End" ? "the Explorer at its widest" : "at its narrowest");
  }
  await page.getByTestId("grip-side").dblclick();
  await page.keyboard.press("ControlOrMeta+b");
  await homeSound(page, "Home with the Explorer hidden");
  await page.keyboard.press("ControlOrMeta+b");
  const dark = (await page.locator("html").getAttribute("data-theme")) !== "dark";
  await theme(page, dark ? "Dark" : "Light");
  await homeSound(page, "Home in the other theme");
}
