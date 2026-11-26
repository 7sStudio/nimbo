// Journey 1 of the Home page: a workspace with no notebook shows the welcome with the cursor in the search field;
// typing "first" and Cmd Enter lands on /ui/first with the page attached and its kernel idle; back on Home the row reads
// idle and Running lists it. The tutorial: Enter in the empty Home's search field starts it (every lesson copied into
// tutorial/, the first opened), the lesson's footer opens the next one, Home then continues it from a row above the
// notebooks, Help > Tutorial shows the lessons with the one in progress first, Continue opens that same copy again
// rather than a new one, and hiding the tutorial from Home takes the row and the activity bar's icon away for good.
import { axeClean, expect, homeShot, row, running, test } from "./home.js";

test("an empty workspace: the welcome, a first notebook created, back on Home it is open", async ({
  page,
  world,
}) => {
  await world.open(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Notebooks for JavaScript and TypeScript",
  );
  await expect(page.getByTestId("learn-primary")).toContainText("Start Tutorial");
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

test("the tutorial: started with Enter, the next lesson from the footer, continued from Home, then hidden", async ({
  page,
  world,
}) => {
  await world.open(page);
  const lessons = page.getByTestId("tutorial").locator("li");
  await expect(lessons).toHaveCount(9);
  await expect(lessons.first()).toContainText("First steps");
  await expect(page.getByTestId("search")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ui\/tutorial\/01-first-steps\?token=/u);
  await expect(page.getByRole("listitem", { name: /^Cell 1, markdown/u })).toContainText(
    "First steps",
  );
  await expect(page.getByTestId("lesson-footer")).toContainText("Lesson 1 of 9");
  await page.getByTestId("lesson-next").click();
  await expect(page).toHaveURL(/\/ui\/tutorial\/02-outputs\?token=/u);
  await expect(page.getByTestId("lesson-footer")).toContainText("Lesson 2 of 9");

  await world.open(page);
  await expect(page.getByTestId("learn")).toHaveCount(0);
  await expect(row(page, "tutorial/09-files-and-git.jsnb")).toBeVisible();
  await expect(page.getByTestId("tutorial-row")).toContainText("Lesson 2 of 9");
  await page.mouse.move(4, 600);
  await homeShot(page, "tutorial-under-way");
  await axeClean(page);

  await page.getByRole("menuitem", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: "Tutorial" }).click();
  await expect(page.locator('[data-lesson="tutorial/02-outputs"]')).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(page.locator('[data-lesson="tutorial/01-first-steps"]')).toHaveAccessibleName(
    /in progress, 0 of 4 cells run$/u,
  );
  await page.getByTestId("learn-primary").click();
  await expect(page).toHaveURL(/\/ui\/tutorial\/02-outputs\?token=/u);
  await world.open(page);
  await expect(row(page, "tutorial/02-outputs-2.jsnb")).toHaveCount(0);

  await page.getByTestId("tutorial-row-hide").click();
  await expect(page.getByTestId("tutorial-row")).toHaveCount(0);
  await expect(page.locator('[data-rail="tutorial"]')).toHaveCount(0);
  await world.open(page);
  await expect(page.getByTestId("tutorial-row")).toHaveCount(0);
  await expect(page.locator('[data-rail="tutorial"]')).toHaveCount(0);
});
