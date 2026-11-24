// Journey 1 of the Home page: a workspace with no notebook shows the empty state with the cursor in
// the search field; typing "first" and Cmd Enter lands on /ui/first with the page attached and its kernel idle; back
// on Home the row reads idle and Running lists it.
import { axeClean, expect, homeShot, row, running, test } from "./home.js";

test("an empty workspace: the empty state, a first notebook created, back on Home it is open", async ({
  page,
  world,
}) => {
  await world.open(page);
  await expect(page.getByTestId("empty")).toContainText("No notebooks");
  await expect(page.getByTestId("running").locator("li")).toHaveCount(0);
  await expect(page.getByTestId("search")).toBeFocused();
  await homeShot(page, "empty");
  await axeClean(page);
  await page.keyboard.type("first");
  await expect(page.getByTestId("create-row")).toContainText("first.jsnb");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page).toHaveURL(/\/ui\/first\?token=/u);
  await expect(page.getByTestId("kernel-state")).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("page-state")).toHaveAttribute("data-state", "attached");
  await page.goBack();
  await expect(row(page, "first.jsnb")).toHaveAccessibleName(/^first.jsnb idle 0 /u);
  await expect(running(page, "first.jsnb")).toContainText("first");
  await expect(page.getByTestId("row-cells")).toHaveText("0");
  await page.mouse.move(4, 600);
  await homeShot(page, "first-open");
  await axeClean(page);
});
