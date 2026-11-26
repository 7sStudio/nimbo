// Journey: user output stays browser-default inside the page. An agent adds a client cell whose output carries elements classed `flex` and `hidden` (the names of Tailwind
// utilities) next to an h1, a button and a table; the user clicks Run all; the page's realm runs the cell and
// CellOutputs slots its real container into the DOM output's `[data-live]` slot inside .jsnb-ui. Each element's
// computed style there equals the same markup's on a bare page.
import type { Page } from "@playwright/test";

import { click, expect, test } from "./world.js";

const markup =
  '<div class="flex" id="u-flex">flex</div><span class="hidden" id="u-hidden">hidden</span>' +
  '<h1 id="u-h1">Title</h1><button id="u-button">Pay</button><table id="u-table"><tr><td>1</td></tr></table>';
const ids = ["u-flex", "u-hidden", "u-h1", "u-button", "u-table"] as const;
const props = [
  "display",
  "margin-block-start",
  "font-size",
  "font-weight",
  "box-sizing",
  "padding-inline-start",
];

/** The computed styles that matter, per element id, in `page`. */
const stylesIn = (page: Page) =>
  page.evaluate(
    ({ ids, props }) =>
      ids.map((id): [string, string] => {
        const element = document.getElementById(id);
        if (element === null) return [id, "missing"];
        const style = getComputedStyle(element);
        return [id, props.map((name) => `${name}:${style.getPropertyValue(name)}`).join(";")];
      }),
    { ids: [...ids], props },
  );

test("a client cell's elements classed flex and hidden keep their browser defaults", async ({
  page,
  world,
  context,
}) => {
  await world.open(page);
  await world.jsnb(
    "cell",
    "add",
    "-n",
    "demo.jsnb",
    "--type",
    "client",
    "--source",
    `display.div().innerHTML = ${JSON.stringify(markup)}`,
  );
  await expect(page.getByRole("listitem", { name: /^Cell 1,/u })).toBeVisible();
  await click(page, "Run All");
  await expect(page.getByTestId("announcer")).toHaveText(/^Cell 1 finished in \d+ ms$/u);

  // CellOutputs slots the realm's own container into its DOM output's [data-live] slot inside .jsnb-ui
  await expect(page.locator(".jsnb-ui [data-live] [data-jsnb-cell] #u-flex")).toHaveCount(1);
  const inPage = await stylesIn(page);

  const bare = await context.newPage();
  await bare.setContent(`<!doctype html><body>${markup}</body>`);
  const browserDefault = await stylesIn(bare);
  await bare.close();

  expect(inPage).toEqual(browserDefault);
  expect(Object.fromEntries(inPage)["u-flex"]).toContain("display:block");
  expect(Object.fromEntries(inPage)["u-hidden"]).toContain("display:inline");
});
