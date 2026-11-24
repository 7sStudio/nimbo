// Journey: nothing is cut off, spills or goes out of line, whatever the names are.
// A notebook with a long file name, a long function name, a long route and a long secret name is run, then every
// place a name shows is opened: the cell headers under the column header, the Explorer, the Environment with its
// forms, the Agent view, the inspector, the bottom panel's tabs (Console, Activity, Problems, Kernel log), an agent
// edit's card and full diff, the palette, the folded cells and a second tab on the notebook, view only; with the regions
// at their widest and narrowest, hidden to their icons, and in the dark theme; with the Search view's matches and every
// cell folded by Alt Z, its name column saying what is inside; and Home with a long folder, file, title, route,
// export and secret, its panels at every size and in both themes (quality-home.ts). The long route's line wraps with its
// continuation hanging under its text, the Environment says its packages in words and shows a secret's Edit on hover,
// its value field focused with the page's one ring. Then the Examples entry opens a copy of the client example, whose
// Run all runs every client cell in the built page, and Open folder moves the page to another folder's daemon after
// asking about the open notebooks. The layout holds at each step and no error reaches the console.
import { writeFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

import { sound, watchErrors } from "./quality.js";
import { clientExample, otherFolder } from "./quality-folders.js";
import { homeLayout } from "./quality-home.js";
import { foldAll, searchView } from "./quality-editor.js";
import { agentCard } from "./quality-review.js";
import type { World } from "./world.js";
import { expect, field, setTheme, test } from "./world.js";

const notebook = "payment-element-with-a-rather-long-file-name.jsnb";
const longName = "createIntentWithAVeryLongFunctionNameThatGoesOnAndOn";
const sources: readonly (readonly [type: string, source: string])[] = [
  [
    "markdown",
    "## A heading long enough to be cut in a narrow outline row, with more words after it\nText.",
  ],
  ["server", `export async function ${longName}(amount: number) {\n  return { amount };\n}`],
  [
    "server",
    'route("POST /webhook/stripe/events/with/a/long/path/segment", async () => ({ ok: true }));',
  ],
  ["client", `const made = await ${longName}(2000);\nmade`],
  ["server", "const refund = null;\nrefund.status"],
  ["server", ""],
];

/** Opens the long-named notebook with its cells added by the agent, and runs them all; resolves its address. */
async function opened(page: Page, world: World): Promise<string> {
  const secret = "STRIPE_WEBHOOK_SECRET_WITH_A_VERY_LONG_NAME_INDEED";
  await writeFile(world.path(".env"), `STRIPE_SECRET_KEY=sk_test_x\n${secret}=whsec_x\n`);
  const url = field(await world.jsnb("open", notebook, "--no-browser"), "url");
  for (const [type, source] of sources)
    await world.jsnb("cell", "add", "-n", notebook, "--type", type, "--source", source);
  await page.goto(url);
  await expect(page.getByTestId("kernel-state")).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("page-state")).toHaveAttribute("data-state", "attached");
  await page.getByRole("button", { name: "Run All", exact: true }).click();
  await expect(
    page.getByRole("listitem", { name: /^Cell 5,/u }).getByTestId("run-fact"),
  ).toHaveAttribute("data-kind", "error");
  return url;
}

/** A second tab on the notebook at `url`: view only, its banner says so, and its layout holds with no error. */
async function viewOnly(page: Page, url: string): Promise<void> {
  const other = await page.context().newPage();
  const errors = watchErrors(other);
  await other.goto(url);
  await expect(other.getByTestId("page-state")).toHaveAttribute("data-state", "viewOnly");
  await expect(other.locator(".jsnb-ui").getByText("View only", { exact: true })).toBeVisible();
  await sound(other, "a view-only second tab");
  errors.none();
  await other.close();
}

/** The Environment in words: packages none yet, a secret row's Edit at rest hidden and shown on hover, and the value
 * field focused with the page's one ring, no border of its own on top. */
async function environment(page: Page): Promise<void> {
  const packages = page.locator('[data-section="packages"]');
  await expect(packages.locator('[data-part="count"]')).toHaveText("0");
  const row = page.getByRole("list", { name: "Secrets" }).getByRole("listitem").first();
  const edit = row.getByRole("button", { name: /^Edit /u });
  await page.mouse.move(0, 0);
  await expect(edit).toHaveCSS("opacity", "0");
  await row.hover();
  await expect(edit).toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "Add secret" }).click();
  await page
    .getByRole("textbox", { name: "Name" })
    .fill("A_NAME_THAT_IS_MUCH_LONGER_THAN_THE_FIELD_IT_IS_TYPED_IN");
  await page.keyboard.press("Tab");
  const value = page.locator("#secret-value");
  await expect(value).toBeFocused();
  await expect(value).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(value).not.toHaveCSS("box-shadow", "none");
}

/** Every place of the side panel and the bottom panel that shows a name. */
async function places(page: Page): Promise<void> {
  await sound(page, "the notebook, the Explorer and the inspector");
  await page.getByRole("button", { name: /^Environment/u }).click();
  await environment(page);
  await sound(page, "the Environment with the secret form");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add package" }).click();
  await sound(page, "the Environment with the package form");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Agent/u }).click();
  await sound(page, "the Agent view");
  await page.locator('[data-rail="settings"]').click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByTestId("settings-list")).toBeVisible();
  await sound(page, "the Settings editor");
  await page.getByTestId("settings-json").click();
  await expect(page.getByTestId("settings-json-editor")).toBeVisible();
  await sound(page, "Settings (JSON)");
  await page.getByTestId("settings-close").click();
  await page.keyboard.press("ControlOrMeta+j");
  await sound(page, "the Console tab");
  await page.getByRole("tab", { name: /^Activity/u }).click();
  await sound(page, "the Activity tab");
  await page.getByRole("tab", { name: /^Problems/u }).click();
  await sound(page, "the Problems tab");
  await page.getByRole("tab", { name: "Kernel log" }).click();
  await expect(page.getByTestId("log-path")).toBeVisible();
  await sound(page, "the Kernel log tab");
  await page.getByRole("button", { name: /^Explorer/u }).click();
}

/** The regions at their widest and narrowest, then hidden to their icons. */
async function sizes(page: Page): Promise<void> {
  const grips = ["grip-side", "grip-inspector", "grip-bottom"];
  for (const key of ["End", "Home"]) {
    for (const grip of grips) {
      await page.getByTestId(grip).focus();
      await page.keyboard.press(key);
    }
    await sound(
      page,
      key === "End" ? "every region at its widest" : "every region at its narrowest",
    );
  }
  for (const grip of grips) await page.getByTestId(grip).dblclick();
  for (const key of ["b", "i", "j"]) await page.keyboard.press(`ControlOrMeta+${key}`);
  await sound(page, "every region hidden");
  for (const key of ["b", "i"]) await page.keyboard.press(`ControlOrMeta+${key}`);
}

test("long names never spill, columns stay aligned and rows even, at every size of the regions and in both themes", async ({
  page,
  world,
}) => {
  test.setTimeout(60_000); // six cells through the CLI and every place a name shows, Home's too: a hang guard
  const errors = watchErrors(page);
  const url = await opened(page, world);
  // a wrapped line's continuation hangs two columns in from its own text
  const routeLine = page
    .getByRole("listitem", { name: /^Cell 3,/u })
    .locator(".cm-line")
    .first();
  await expect(routeLine).toHaveClass(/\bcm-hang-0\b/u);
  await expect(routeLine).not.toHaveCSS("text-indent", "0px");
  await places(page);
  await viewOnly(page, url);
  // every cell came from the agent: its lines are violet, and the card and the full diff hold a long name
  await agentCard(page, "with long names");
  await searchView(page, longName.slice(0, 12));
  await foldAll(page, "with long names");
  await sizes(page);
  await page
    .getByRole("listitem", { name: /^Cell 2,/u })
    .getByRole("button", { name: "Fold the cell to this row" })
    .click();
  await sound(page, "a folded cell");
  await page.getByTestId("command-input").click();
  await page.keyboard.type(longName.slice(0, 12));
  await sound(page, "the palette");
  await page.keyboard.press("Escape");
  await setTheme(page, "Dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await sound(page, "the dark theme");
  await page.keyboard.press("ControlOrMeta+j");
  await sound(page, "the dark theme with the bottom panel");
  await foldAll(page, "with long names in the dark theme");
  await homeLayout(page, world, longName);
  await clientExample(page);
  await otherFolder(page, world);
  errors.none();
});
