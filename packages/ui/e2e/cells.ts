// What the cells journeys share: the cell items by number, the agent's cell add, a wait until every
// editor has its grammar and every markdown block its prose (both are chunks of their own, so a screenshot taken
// before them would race), and axe on the page with serious and critical violations failing.
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";

import type { World } from "./world.js";
import { expect, field } from "./world.js";

/** The list item of cell `n` (1-based), by its label ("Cell 3, server, ok"). */
export const cell = (page: Page, n: number): Locator =>
  page.getByRole("listitem", { name: new RegExp(`^Cell ${String(n)},`, "u") });

/** Every cell item. */
export const cells = (page: Page): Locator => page.getByRole("listitem", { name: /^Cell \d+,/u });

/** The agent adds a cell through the CLI; resolves its id. */
export async function agentAdds(world: World, type: string, source: string): Promise<string> {
  const added = await world.jsnb(
    "cell",
    "add",
    "-n",
    "demo.jsnb",
    "--type",
    type,
    "--source",
    source,
  );
  return field(added, "cell", "id");
}

/** Every editor highlighted and every markdown block rendered. */
export async function settled(page: Page): Promise<void> {
  await expect(page.locator('[data-part="editor"]:not([data-grammar])')).toHaveCount(0);
  await expect(page.locator(".ui\\:prose:not([data-rendered])")).toHaveCount(0);
}

/** axe over the page's own tree: no serious or critical violation. */
export async function axeClean(page: Page): Promise<void> {
  const axe = await new AxeBuilder({ page }).include(".jsnb-ui").analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
}

/** The run fact of cell `n` ("ok", "error", "running", …). */
export const runOf = (page: Page, n: number): Locator => cell(page, n).getByTestId("run-fact");
