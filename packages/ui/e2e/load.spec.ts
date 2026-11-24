// Journey: opening a notebook: the page comes up idle with the file in the top bar, the
// kernel and the page in the status bar, the Explorer open on the workspace beside the inspector, and nothing an
// accessibility check calls serious; and no banner
// about a missing page flashes on the tab that is attaching it.
import { cells } from "./cells.js";
import AxeBuilder from "@axe-core/playwright";

import { panel } from "./panels.js";
import { expect, shot, test } from "./world.js";

test("a notebook opens idle, its kernel and page shown in the status bar", async ({
  page,
  world,
}) => {
  await world.open(page);
  await expect(page.getByTestId("place")).toHaveText("demo.jsnb");
  await expect(page.getByTestId("kernel-state")).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("page-state")).toHaveAttribute("data-state", "attached");
  await expect(page.getByRole("button", { name: "Run All" })).toBeEnabled();
  await expect(page.getByTestId("cell-list")).toBeAttached();
  await expect(cells(page)).toHaveCount(0);
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-save", "saved");
  const explorer = panel(page, "Explorer");
  await expect(
    explorer.getByRole("tree", { name: "Notebooks" }).locator('[aria-current="page"]'),
  ).toContainText("demo.jsnb");
  await expect(page.getByTestId("mode")).toHaveText("Command");
  await shot(page, "idle");
  const axe = await new AxeBuilder({ page }).include(".jsnb-ui").analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
});

test("the tab that holds the page never flashes 'No page attached' while it attaches", async ({
  page,
  world,
}) => {
  // every banner that ever enters the page, recorded from the first paint on
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { bannersSeen: seen });
    new MutationObserver(() => {
      for (const banner of document.querySelectorAll("[data-banner]"))
        seen.push(banner.getAttribute("data-banner") ?? "");
    }).observe(document, { childList: true, subtree: true });
  });
  for (const load of [1, 2]) {
    await world.open(page);
    await expect(page.getByTestId("page-state"), `load ${String(load)}`).toHaveAttribute(
      "data-state",
      "attached",
    );
    expect(await page.evaluate((): unknown => Reflect.get(window, "bannersSeen"))).toEqual([]);
  }
});
