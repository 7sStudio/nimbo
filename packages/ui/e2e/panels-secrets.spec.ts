// Journey: the Environment view's Secrets, opened from the icon bar: a secret added through the form (the
// value a password field, never shown again and never in the page once set), the cells that read it through env,
// a name the dotenv rule refuses, Edit with the name filled in, an agent's secret appearing on the next open; the
// dark theme; axe clean in both themes.
import { appendFile } from "node:fs/promises";

import type { Locator, Page } from "@playwright/test";

import { axeClean } from "./cells.js";
import { addAndRun, openView, panelShot, section, viewButton } from "./panels.js";
import { expect, setTheme, test } from "./world.js";

/** The form refuses a name the dotenv rule does not take, then sets STRIPE_KEY; its value is never in the page. */
async function addOne(page: Page, secrets: Locator, form: Locator): Promise<void> {
  await secrets.getByRole("button", { name: "Add secret" }).click();
  await expect(form.getByRole("textbox", { name: "Name" })).toBeFocused();
  await form.getByRole("textbox", { name: "Name" }).fill("bad name");
  await expect(form).toContainText("A-Z, 0-9 and _, starting with a letter");
  await expect(form.getByRole("button", { name: /^Save/u })).toBeDisabled();
  await form.getByRole("textbox", { name: "Name" }).fill("STRIPE_KEY");
  await form.getByLabel("Value").fill("sk_test_secret_123");
  await expect(form.getByLabel("Value")).toHaveAttribute("type", "password");
  await panelShot(page, "secrets-form");
  await axeClean(page);
  await form.getByRole("button", { name: /^Save/u }).click();
  await expect(form).toHaveCount(0);
  expect(await page.content()).not.toContain("sk_test_secret_123");
}

/** Edit fills the name and focuses the value; Enter sets it. */
async function replace(page: Page, secrets: Locator, form: Locator): Promise<void> {
  await secrets.getByRole("button", { name: "Edit STRIPE_KEY" }).click();
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue("STRIPE_KEY");
  await expect(form.getByLabel("Value")).toBeFocused();
  await expect(form.getByLabel("Value")).toHaveValue("");
  await form.getByLabel("Value").fill("sk_test_other");
  await form.getByLabel("Value").press("Enter");
  await expect(form).toHaveCount(0);
  expect(await page.content()).not.toContain("sk_test_other");
}

test("the Secrets section adds secrets, says which cells read them and replaces one without showing a value", async ({
  page,
  world,
}) => {
  await world.open(page);
  const secrets = section(await openView(page, "Environment"), "Secrets");
  const count = secrets.locator('[data-part="count"]');
  await expect(count).toHaveText("0");
  const form = secrets.getByRole("form", { name: "Set a secret" });
  const rows = secrets.getByRole("list", { name: "Secrets" }).getByRole("listitem");
  await addOne(page, secrets, form);
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('[data-part="uses"]')).toHaveText("unused");
  await expect(count).toHaveText("1");

  await addAndRun(page, world, [
    ["server", "const key = env.STRIPE_KEY;\n// STRIPE_KEY is a test key"],
  ]);
  await expect(rows.first().locator('[data-part="uses"]')).toHaveText("cell 1");
  // a secret written beside the page (an agent, an editor): the view reads the names again when it opens
  await appendFile(world.path(".env"), "AGENT_TOKEN=t0k3n\n");
  await viewButton(page, "Environment").click();
  await viewButton(page, "Environment").click();
  await expect(rows).toHaveCount(2);
  await panelShot(page, "secrets-listed");
  await replace(page, secrets, form);
  await expect(rows).toHaveCount(2);
  await setTheme(page, "Dark");
  await panelShot(page, "secrets-dark");
  await axeClean(page);
});
