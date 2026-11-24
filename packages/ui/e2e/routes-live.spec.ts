// Journey: routes on the page as they happen (04-kernel §5.6, §8): a server cell's routes show as
// "listening" in its header's State column, in the status bar's count and as rows of the inspector's Routes at once;
// requests a webhook sender makes without the token raise the requests in the open inspector and in the cell's state,
// and fill the cell's result, one block per route with its count, address and Copy URL and one row per request (time,
// status, event type), never the disposer route() returns; a handler that throws answers 500, its row says so and its
// error shows under the cell later while the cell stays ok; Copy URL gives the URL that
// answers, escaped for a path that needs it, and the row shows that address. Nothing is reopened to see a change: routes.changed and the late outputs
// reach the page as they come. Dark theme and axe at the end.
import type { Page } from "@playwright/test";

import { axeClean, cell, runOf } from "./cells.js";
import { addAndRun, openInspector, panel, panelShot, section } from "./panels.js";
import { expect, setTheme, test } from "./world.js";

const webhook = `route("POST /webhook", async (req) => ({ received: (await req.json()).type }))
route("GET /ping", () => "pong")`;

/** The inspector's Routes group. */
const routesOf = (page: Page) => section(panel(page, "Inspector"), "Routes");

/** The open inspector's row of the route at `path`. */
const row = (page: Page, path: string) =>
  routesOf(page)
    .getByRole("list", { name: "Routes" })
    .getByRole("listitem")
    .filter({ hasText: path });

/** The status bar's count of the routes listening. */
const count = (page: Page) => page.getByTestId("status-routes");

/** A webhook sender's POST, as `stripe listen` forwards one: no token, a JSON body. */
const deliver = (origin: string, type: string) =>
  fetch(`${origin}/n/demo/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type }),
  });

test("a cell's routes show at once: its state, the status bar's count, the inspector's rows, then requests and activity", async ({
  page,
  world,
}) => {
  await world.open(page);
  await openInspector(page);
  await expect(count(page)).toHaveCount(0);
  await addAndRun(page, world, [["server", webhook]]);
  await expect(count(page)).toHaveText("2 routes");
  await expect(row(page, "/webhook").getByRole("button", { name: "Go to cell 1" })).toBeVisible();
  await expect(row(page, "/ping").locator('[data-part="hits"]')).toHaveText("0 requests");
  await panelShot(page, "registered");

  expect((await deliver(world.origin, "payment_intent.succeeded")).status).toBe(200);
  expect((await deliver(world.origin, "charge.refunded")).status).toBe(200);
  expect(await (await fetch(`${world.origin}/n/demo/ping`)).text()).toBe("pong");
  await expect(row(page, "/webhook").locator('[data-part="hits"]')).toHaveText("2 requests");
  await expect(row(page, "/ping").locator('[data-part="hits"]')).toHaveText("1 request");
  const hooks = cell(page, 1).getByRole("region", { name: "Requests to POST /webhook" });
  await expect(hooks.locator('[data-part="hits"]')).toHaveText("2 requests");
  await expect(hooks.getByRole("listitem")).toHaveText([
    /^\d\d:\d\d:\d\d200[\d.]+ mspayment_intent\.succeeded$/u,
    /^\d\d:\d\d:\d\d200[\d.]+ mscharge\.refunded$/u,
  ]);
  const ping = cell(page, 1).getByRole("region", { name: "Requests to GET /ping" });
  await expect(ping.locator('[data-part="hits"]')).toHaveText("1 request");
  await expect(ping.getByRole("listitem")).toHaveText([/^\d\d:\d\d:\d\d200[\d.]+ ms$/u]);
  // the disposer route() returns is the cell's last value, and nothing to read
  await expect(cell(page, 1).locator('[data-part="output"]')).toHaveCount(0);
  await expect(runOf(page, 1)).toHaveAttribute("data-kind", "ok");
  await panelShot(page, "hits");
  await axeClean(page);
  await setTheme(page, "Dark");
  await panelShot(page, "hits-dark");
  await axeClean(page);
});

test("a handler that throws answers 500; its error shows under the cell later, and the cell stays ok", async ({
  page,
  world,
}) => {
  await world.open(page);
  await addAndRun(page, world, [
    ["server", 'route("GET /boom", () => { throw new Error("nope") })'],
  ]);
  const answer = await fetch(`${world.origin}/n/demo/boom`);
  expect([answer.status, await answer.text()]).toEqual([500, "Error: nope"]);
  await expect(cell(page, 1).getByText("Error: nope")).toBeVisible();
  await expect(
    cell(page, 1).getByRole("region", { name: "Requests to GET /boom" }).getByRole("listitem"),
  ).toHaveText([/^\d\d:\d\d:\d\d500[\d.]+ ms$/u]);
  await expect(runOf(page, 1)).toHaveAttribute("data-kind", "ok");
  await panelShot(page, "thrown");
  await axeClean(page);
});

test("Copy URL gives the URL that answers, escaped for a path that needs it", async ({
  page,
  world,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await world.open(page);
  await addAndRun(page, world, [["server", 'route("GET /café", () => "crème")']]);
  const routes = section(await openInspector(page), "Routes");
  await routes.getByRole("button", { name: "Copy URL of GET /café" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied the URL" })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toBe(`${world.origin}/n/demo/caf%C3%A9`);
  expect(await (await fetch(url)).text()).toBe("crème");
  await expect(routes.getByTestId("route-url")).toHaveText(
    `${world.origin.replace(/^https?:\/\//u, "")}/n/demo/caf%C3%A9`,
  );
  await page.getByRole("button", { name: "Dismiss" }).click();
  await panelShot(page, "escaped");
});
