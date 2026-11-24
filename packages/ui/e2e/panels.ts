// What the panels journeys share: the icon bar's buttons, the side panel as a region named by its view,
// the inspector and its groups, the bottom panel and its tabs, the cells run from the page like a user (select, ⌘↩),
// and the screenshot after the pointer has left the icon bar (its tooltips would otherwise sit in the shot).
import type { Locator, Page } from "@playwright/test";

import { agentAdds, cell, cells, runOf, settled } from "./cells.js";
import type { World } from "./world.js";
import { expect, regionsLoaded, rest, shot } from "./world.js";

/** The side panel's views, by the title each is named by. */
export type View = "Explorer" | "Environment" | "Agent";

/** The icon bar's button for `title` ("Explorer, outline and files", /^Agent/u). */
export const railButton = (page: Page, title: string | RegExp): Locator =>
  page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: title });

/** The icon that opens `view`. */
export const viewButton = (page: Page, view: View): Locator =>
  railButton(page, new RegExp(`^${view},`, "u"));

/** The open side panel (named by its view's title) or the inspector ("Inspector"). */
export const panel = (page: Page, title: string | RegExp): Locator =>
  page.getByRole("complementary", { name: title });

/** A group of a side view or of the inspector, by its title ("Variables", "Packages"). */
export const section = (within: Locator, title: string): Locator =>
  within.getByRole("region", { name: title, exact: true });

/** Shows `view` in the side panel from the icon bar (a click, unless it shows already) and waits for its body, a chunk
 * of its own. */
export async function openView(page: Page, view: View): Promise<Locator> {
  const opened = panel(page, view);
  if (!(await opened.isVisible())) {
    await viewButton(page, view).click();
  }
  await expect(opened.getByRole("heading", { level: 2 })).toHaveText(view);
  await rest(page);
  return opened;
}

/** The inspector, shown from its rail's icon when it is hidden. */
export async function openInspector(page: Page): Promise<Locator> {
  const inspector = panel(page, "Inspector");
  if ((await page.locator("#inspector").count()) === 0)
    await page.locator('[data-switch="inspector"]').click();
  await expect(inspector.getByRole("heading", { level: 2 })).toBeVisible();
  await rest(page);
  return inspector;
}

/** The bottom panel, a region named "Panel". */
export const bottomPanel = (page: Page): Locator => page.getByRole("region", { name: "Panel" });

/** Shows the bottom panel from the status bar's Problems item (unless it shows already) on `tab`, and answers it. */
export async function openBottom(
  page: Page,
  tab: "Console" | "Activity" | "Problems" | "Kernel log",
): Promise<Locator> {
  if ((await page.locator("#bottom").count()) === 0)
    await page.getByTestId("status-problems").click();
  const bottom = bottomPanel(page);
  const chosen = bottom.getByRole("tab", { name: new RegExp(`^${tab}`, "u") });
  if ((await chosen.getAttribute("aria-selected")) !== "true") await chosen.click();
  await expect(chosen).toHaveAttribute("aria-selected", "true");
  await rest(page);
  return bottom;
}

/** The agent adds cells; the page runs each one from the keyboard and waits until it ended as `ends` says. */
export async function addAndRun(
  page: Page,
  world: World,
  sources: readonly (readonly [type: string, source: string])[],
  ends: "ok" | "error" = "ok",
): Promise<void> {
  for (const [type, source] of sources) await agentAdds(world, type, source);
  await expect(cells(page)).toHaveCount(sources.length);
  for (let n = 1; n <= sources.length; n += 1) {
    await cell(page, n).locator('[data-part="number"]').click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(runOf(page, n)).toHaveAttribute("data-kind", ends);
  }
  await page.keyboard.press("Escape");
}

/** A whole-page screenshot once the regions, editors and prose settled, every cell's run fact masked (it says when the
 * cell ran). */
export async function panelShot(
  page: Page,
  name: string,
  clocks: readonly Locator[] = [],
): Promise<void> {
  await rest(page);
  await regionsLoaded(page);
  await settled(page);
  await expect(page.locator(".jsnb-ui").getByText(/^Reading the /u)).toHaveCount(0);
  // the run facts carry the time of the run, an event's row its time and a route's URL the daemon's port
  const varying = [
    page.getByTestId("run-fact"),
    page.locator('[data-part="event-time"]'),
    page.getByTestId("route-url"),
  ];
  await shot(page, name, [...varying, ...clocks]);
}
