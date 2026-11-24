// The Home page journeys' world: a temporary workspace named `experiments` whose
// daemon the built CLI started with `nimbo open --no-browser` and no path, so it opens nothing and answers the Home
// page's address; the CLI is the agent beside the user's page. What every Home journey shares: the rows, the Running
// kernels list, the masks of its clocks, and axe.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test as base } from "@playwright/test";

import { cleanEnv, field, jsnbIn, shot } from "./world.js";

export type HomeWorld = {
  readonly dir: string;
  readonly path: (...parts: readonly string[]) => string;
  /** The Home page's address, `/ui/?token=…`, as `nimbo open` printed it. */
  readonly url: string;
  readonly origin: string;
  readonly token: string;
  /** What `nimbo open --no-browser --json` printed when it started the daemon. */
  readonly opened: unknown;
  /** The CLI as the agent: its --json output parsed. */
  readonly jsnb: (...args: readonly string[]) => Promise<unknown>;
  /** Opens the Home page and waits until its list has loaded. */
  readonly open: (page: Page) => Promise<void>;
};

export const test = base.extend<{ world: HomeWorld }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; it has none
  world: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), "nimbo-home-"));
    const dir = join(root, "experiments");
    await mkdir(join(dir, ".jsnb"), { recursive: true });
    const env = cleanEnv(dir);
    const jsnb = (...args: readonly string[]) => jsnbIn(dir, env, args);
    const opened = await jsnb("open", "--no-browser", "--background");
    const url = field(opened, "url");
    const parsed = new URL(url);
    const world: HomeWorld = {
      ...{ dir, path: (...parts) => join(dir, ...parts), url, opened, jsnb },
      origin: parsed.origin,
      token: parsed.searchParams.get("token") ?? "",
      open: async (page) => {
        await page.goto(url);
        await expect(page.getByTestId("summary")).toBeVisible();
      },
    };
    try {
      await use(world);
    } finally {
      await jsnb("stop").catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  },
});

export { expect };

/** The row of notebook `path` in the list. */
export const row = (page: Page, path: string): Locator =>
  page.getByTestId("notebooks").locator(`[role="option"][data-path="${path}"]`);

/** The Running kernels entry of `path`. */
export const running = (page: Page, path: string): Locator =>
  page.getByTestId("running").locator(`li[data-path="${path}"]`);

/** The Home page against its baseline, its clocks masked: the files' times, the daemon's pid, the Node the kernels run
 * on and when the last result ended (the workspace's folder is masked by every shot). */
export const homeShot = (page: Page, name: string): Promise<void> =>
  shot(page, name, [page.getByTestId("row-modified"), page.getByTestId("workspace-path")]);

/** No serious or critical axe finding on the page. */
export async function axeClean(page: Page): Promise<void> {
  const axe = await new AxeBuilder({ page }).include(".jsnb-ui").analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
}
