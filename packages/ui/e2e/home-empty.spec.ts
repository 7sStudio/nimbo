// Journey 1 of the Home page: a workspace with no notebook shows the empty state with the cursor in
// the search field; typing "first" and Cmd Enter lands on /ui/first with the page attached and its kernel idle; back
// on Home the row reads idle and Running lists it. Start Tutorial copies the nine lessons into tutorial/ and opens the
// first; back on Home the empty state is gone, and Help > Start Tutorial opens that copy again rather than a new one.
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

test("an empty workspace: Start Tutorial copies the lessons and opens the first, and opens that copy again", async ({
  page,
  world,
}) => {
  await world.open(page);
  await expect(page.getByTestId("tutorial").locator("li")).toHaveCount(9);
  await expect(page.getByTestId("tutorial").locator("li").first()).toContainText("First steps");
  await page.getByTestId("start-tutorial").click();
  await expect(page).toHaveURL(/\/ui\/tutorial\/01-first-steps\?token=/u);
  await expect(page.getByRole("listitem", { name: /^Cell 1, markdown/u })).toContainText(
    "First steps",
  );
  await page.goBack();
  await expect(page.getByTestId("empty")).toHaveCount(0);
  await expect(row(page, "tutorial/09-files-and-git.jsnb")).toBeVisible();
  await page.getByRole("menuitem", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: "Start Tutorial" }).click();
  await expect(page).toHaveURL(/\/ui\/tutorial\/01-first-steps\?token=/u);
  await page.goBack();
  await expect(row(page, "tutorial/01-first-steps-2.jsnb")).toHaveCount(0);
});
