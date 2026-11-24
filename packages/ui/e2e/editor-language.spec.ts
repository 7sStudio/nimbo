// Journey: the language service in a cell's editor, as a user meets it, page to socket to
// daemon to worker and back. A hover over a built-in in a cell never clicked shows its type; in a new cell `Array.`
// lists the constructor's members and never the notebook's words, `new Box().` the members of a class another cell
// declares, and `greet(` opens the signature help, which Esc closes without leaving the editor. Before this journey a
// focus in any cell remade every cell's plugin and dropped the request in flight, and a page built before the service
// showed only the notebook's words after a dot (2026-11-15). A hint's JSDoc links go to their definition or open a
// tab, and File > Preferences > Syntax Theme recolours the code.
import type { Locator, Page } from "@playwright/test";

import { agentAdds, cell, cells, settled } from "./cells.js";
import type { World } from "./world.js";
import { expect, rest, shot, test } from "./world.js";

const declarations = [
  "class Box {",
  "  open(label: string): string {",
  "    return label;",
  "  }",
  "}",
  "function greet(name: string, times: number): string {",
  "  return name.repeat(times);",
  "}",
  "const address = 'Amsterdam';",
].join("\n");

/** The agent writes a class, a function and a word-filled constant, then a cell that uses `Array`. */
async function seed(page: Page, world: World): Promise<void> {
  await world.open(page);
  await agentAdds(world, "server", declarations);
  await agentAdds(world, "server", "Array.isArray([address])");
  await expect(cells(page)).toHaveCount(2);
  await settled(page);
}

/** A new server cell from the add row, in edit mode; resolves its editor. */
async function newCell(page: Page): Promise<Locator> {
  await page
    .getByRole("group", { name: "Add a cell" })
    .getByRole("button", { name: "Server", exact: true })
    .click();
  // the add button opens the new cell's editor, as VS Code's + Code does
  const editor = cell(page, 3).getByRole("textbox", { name: "Cell 3 source" });
  await expect(editor).toBeFocused();
  return editor;
}

/** Replaces the editor's text with `text`, typed: each step on a fresh text, since `Array.` then `new Box().` on the
 * next line would read as one member chain. */
async function retype(page: Page, text: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text);
}

test("hover, member completion and signature help answer from TypeScript", async ({
  page,
  world,
}) => {
  await seed(page, world);
  // a hover in a cell the user never clicked
  await cell(page, 2)
    .locator(".cm-line")
    .first()
    .hover({ position: { x: 12, y: 8 } });
  await expect(page.locator(".cm-tooltip-hover")).toContainText("ArrayConstructor");
  await rest(page);

  const editor = await newCell(page);
  const list = page.locator(".cm-tooltip-autocomplete");
  await retype(page, "Array.");
  await expect(list.getByRole("option", { name: /^isArray\b/u })).toBeVisible();
  await expect(list.getByRole("option", { name: /^from\b/u })).toBeVisible();
  // the notebook's words (address, Amsterdam, label) are never offered after a dot
  await expect(list.locator(".cm-completionDetail", { hasText: /^(name|import)$/u })).toHaveCount(
    0,
  );
  await settled(page);
  await shot(page, "members");
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);

  await retype(page, "new Box().");
  await expect(list.getByRole("option", { name: /^open\b/u })).toBeVisible();
  await page.keyboard.press("Escape");

  await retype(page, "greet(");
  const signature = page.locator(".cm-lsp-signature-tooltip");
  await expect(signature).toContainText("greet(name: string, times: number): string");
  await page.keyboard.press("Escape");
  await expect(signature).toHaveCount(0);
  await expect(editor).toBeFocused();
});

test("a hint's documentation links go to their definition, and the syntax theme recolours the code", async ({
  page,
  world,
}) => {
  await seed(page, world);
  await newCell(page);
  // a JSDoc link to another cell's function and one to the web, in the parameter hints of a function that has both
  await page.keyboard.insertText(
    "/** Wraps {@link greet}. @see {@link https://example.com Example} */\nfunction wrap(): void {}\n",
  );
  await page.keyboard.type("wrap(");
  const hint = page.locator(".cm-lsp-signature-tooltip");
  await expect(hint.getByRole("link", { name: "greet", exact: true })).toBeVisible();
  const opened = page.context().waitForEvent("page");
  await hint.getByRole("link", { name: "Example" }).click();
  const tab = await opened;
  expect(tab.url()).toContain("example.com");
  await tab.close();
  await hint.getByRole("link", { name: "greet", exact: true }).click();
  // the definition's cell is selected and its editor holds the caret on greet's line
  await expect(cell(page, 1)).toHaveAttribute("data-selected", "");
  await expect(cell(page, 1).locator(".cm-activeLine")).toContainText("function greet");

  // File > Preferences > Syntax Theme > GitHub: the tokens take GitHub's colours, then VS Code's again
  const kw = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--kw"));
  expect(await kw()).toContain("#0000ff");
  for (const name of ["File", "Preferences", "Syntax Theme"])
    await page.getByRole("menuitem", { name, exact: true }).click();
  await page.getByRole("menuitem", { name: "GitHub", exact: true }).click();
  await expect.poll(kw).toContain("#cf222e");
  for (const name of ["File", "Preferences", "Syntax Theme"])
    await page.getByRole("menuitem", { name, exact: true }).click();
  await page.getByRole("menuitem", { name: "VS Code", exact: true }).click();
  await expect.poll(kw).toContain("#0000ff");
});
