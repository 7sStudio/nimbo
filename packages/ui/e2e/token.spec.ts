// Journey: a page whose token is wrong while its page cookie still lets the page itself load (an old link in a browser
// that has the daemon's cookie): the socket is refused (4401), so the page stops at once and
// says so in one banner, the status bar reads disconnected, no toast repeats it, and nothing claims a notebook it never
// loaded. A notebook that is gone (a valid token) stops the same way and names it.
import AxeBuilder from "@axe-core/playwright";

import { expect, shot, test } from "./world.js";

test("a stale token says 'Not authorized' once and claims nothing", async ({
  page,
  context,
  world,
}) => {
  await world.open(page);
  const stale = await context.newPage();
  await stale.goto(`${world.origin}/ui/demo?token=not-the-token`);
  const banner = stale.locator('[data-banner="notConnected"]');
  await expect(banner).toContainText("Not authorized");
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(stale.getByTestId("page-state")).toHaveAttribute("data-state", "closed");
  await expect(stale.getByTestId("cell-list")).toHaveCount(0);
  await expect(stale.getByTestId("notebook-toolbar")).toHaveCount(0);
  await expect(stale.locator('[data-slot="toast"]')).toHaveCount(0);
  await shot(stale, "not-authorized");
  const axe = await new AxeBuilder({ page: stale }).include(".jsnb-ui").analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
});

test("a notebook that is gone says so by name, attaches nothing and offers no run", async ({
  page,
  world,
}) => {
  // a renamed or deleted notebook reloaded from history, with a token that is still good
  await page.goto(`${world.origin}/ui/gone?token=${world.token}`);
  const banner = page.locator('[data-banner="notConnected"]');
  await expect(banner).toContainText("Notebook not open");
  await expect(banner).toContainText("gone.jsnb");
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("page-state")).toHaveAttribute("data-state", "closed");
  await expect(page.getByTestId("cell-list")).toHaveCount(0);
  await expect(page.getByTestId("notebook-toolbar")).toHaveCount(0);
  await page.locator("#page").click();
  await page.keyboard.press("0");
  await page.keyboard.press("0");
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
  await shot(page, "notebook-not-found");
});
