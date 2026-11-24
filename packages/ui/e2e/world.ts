// Each journey's own world (09-testing §1.6): a temporary workspace named `experiments`, the real daemon
// started by the built `nimbo` CLI (`nimbo open demo.jsnb --no-browser --background`, which finds the built UI and passes
// it with --ui), the user's page in Chromium, and the CLI as the agent beside it. The daemon is stopped (`nimbo stop`) and
// the folder removed after the test. User settings go to a config folder inside the workspace, never the user's home.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { Locator, Page } from "@playwright/test";
import { expect, test as base } from "@playwright/test";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../../cli/dist/main.js", import.meta.url));

export type World = {
  /** The workspace folder. */
  readonly dir: string;
  readonly path: (...parts: readonly string[]) => string;
  /** The notebook's page, `/ui/demo?token=…`. */
  readonly url: string;
  /** The daemon's origin and token. */
  readonly origin: string;
  readonly token: string;
  /** The CLI as the agent (`client=cli`): its --json output parsed. */
  readonly jsnb: (...args: readonly string[]) => Promise<unknown>;
  /** The environment the CLI and the daemon it starts run with. */
  readonly env: Readonly<Record<string, string>>;
  /** Opens the notebook's page (or `path` on the daemon, with the token) and waits until it has started: the notebook
   * hydrated, the workspace loaded, the kernel idle and the page attached or view only. */
  readonly open: (page: Page, path?: string) => Promise<void>;
};

/** The test process's environment without npm's own settings (pnpm sets some), so the workspace's .npmrc decides. */
export function cleanEnv(dir: string): Record<string, string> {
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].toLowerCase().startsWith("npm_config_"),
  );
  return { ...Object.fromEntries(kept), XDG_CONFIG_HOME: join(dir, ".config-home") };
}

export async function jsnbIn(dir: string, env: Record<string, string>, args: readonly string[]) {
  const { stdout } = await run(process.execPath, [cli, ...args, "--json"], { cwd: dir, env });
  const parsed: unknown = stdout.trim() === "" ? null : JSON.parse(stdout);
  return parsed;
}

/** A string field of the CLI's JSON output; the journey fails here when the output lacks it. */
export function field(value: unknown, ...path: readonly string[]): string {
  const found: unknown = path.reduce<unknown>(
    (at, key) => (typeof at === "object" && at !== null ? Reflect.get(at, key) : undefined),
    value,
  );
  if (typeof found !== "string") throw new Error(`the CLI's output has no ${path.join(".")}`);
  return found;
}

async function makeWorld(dir: string): Promise<World> {
  const env = cleanEnv(dir);
  await mkdir(join(dir, ".jsnb"), { recursive: true });
  const jsnb = (...args: readonly string[]) => jsnbIn(dir, env, args);
  const url = field(await jsnb("open", "demo.jsnb", "--no-browser", "--background"), "url");
  const parsed = new URL(url);
  const token = parsed.searchParams.get("token") ?? "";
  return {
    dir,
    path: (...parts) => join(dir, ...parts),
    url,
    origin: parsed.origin,
    token,
    jsnb,
    env,
    open: async (page, path) => {
      await page.goto(path === undefined ? url : `${parsed.origin}${path}?token=${token}`);
      if (path !== undefined) {
        await expect(page.getByTestId("output-tab")).toBeVisible();
        return;
      }
      await expect(page.getByTestId("place")).toContainText(".jsnb");
      await expect(page.getByTestId("kernel-state")).toHaveAttribute("data-state", "idle");
      await expect(page.getByTestId("page-state")).toHaveAttribute(
        "data-state",
        /^(attached|viewOnly)$/u,
      );
      await regionsLoaded(page);
      // what the open regions read on start (the workspace's notebooks, the kernel's scope) has answered
      await expect(page.locator(".jsnb-ui").getByText(/^Reading the /u)).toHaveCount(0);
    },
  };
}

export const test = base.extend<{ world: World }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; it has none
  world: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), "jsnb-ui-"));
    const dir = join(root, "experiments");
    await mkdir(dir);
    const world = await makeWorld(dir);
    try {
      await use(world);
    } finally {
      await world.jsnb("stop").catch(() => undefined); // a journey that stopped the daemon itself leaves nothing to stop
      await rm(root, { recursive: true, force: true });
    }
  },
});

export { expect };

/** The toasts that say `text`. The inspector and the panels have status lines of their own (a closed notebook's
 * Variables say it is not open), so a journey about toasts asks for toasts. */
export const toasts = (page: Page, text: string): Locator =>
  page.locator('[data-slot="toast"]').filter({ hasText: text });

/** Moves the pointer to the title bar's empty stretch between the menus and the command center, where nothing reacts
 * to it: no tooltip stays open, no cell row shows its actions and no gap its add buttons in the next screenshot. */
export async function rest(page: Page): Promise<void> {
  await page.mouse.move(400, 16);
}

/** Clicks like a user, then rests the pointer so no tooltip stays open for the next screenshot. */
/** The theme picked from the activity bar's gear (Manage > Theme), as a user does. */
export async function setTheme(page: Page, name: "Light" | "Dark"): Promise<void> {
  await page.locator('[data-rail="settings"]').click();
  await page.getByRole("menuitem", { name: "Theme" }).click();
  await page.getByRole("menuitem", { name }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", name.toLowerCase());
}

export async function click(page: Page, name: string, role: "button" = "button"): Promise<void> {
  await page.getByRole(role, { name, exact: true }).click();
  await rest(page);
}

/** The workbench's open regions (side panel, inspector, bottom panel) each show their first row: their bodies are chunks
 * of their own, so a screenshot or a click taken before them would race. */
export async function regionsLoaded(page: Page): Promise<void> {
  await expect(
    page.locator("#side:not(:has(h2)), #inspector:not(:has(h2)), #bottom:not(:has(h2))"),
  ).toHaveCount(0);
}

/** A screenshot of the whole page against its baseline, the workspace's temporary path masked (it differs per run),
 * and any other locator a step names whose text is a running clock. */
export async function shot(
  page: Page,
  name: string,
  clocks: readonly Locator[] = [],
): Promise<void> {
  await regionsLoaded(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    // a running cell's elapsed time and a run's duration are clocks wherever they show
    mask: [
      page.getByTestId("workspace-path"),
      // the Node the kernels run on is this machine's
      page.getByTestId("kernel-node"),
      page.getByTestId("toolbar-kernel"),
      page.getByTestId("cell-elapsed"),
      page.locator('[data-part="duration"]'),
      // a finished run's state says when it ran ("ran at 14:01") or how long it went ("interrupted after 1.2 s"),
      // and the Agent view's rows when the edit was made
      page.locator('[data-testid="run-fact"]:is([data-kind="ok"], [data-kind="interrupted"])'),
      page.locator('[data-part="edit"]'),
      // a run's check or cross with its duration, whatever its state
      page.locator('[data-testid="run-fact"]:has([data-testid="run-outcome"])'),
      // a route request's time, and the Bridge's last call (when, and how long it took)
      page.locator('[data-part="took"]'),
      page.locator('[data-part="last-call"]'),
      ...clocks,
    ],
    stylePath: fileURLToPath(new URL("screenshot.css", import.meta.url)),
  });
}

/**
 * The live regions a screen reader would announce `text` from: an element whose aria-live is polite or assertive, or
 * whose role is alert or status with no aria-live of its own, counted once even when one sits inside another.
 */
export const announcements = (page: Page, text: string): Promise<number> =>
  page.evaluate((wanted) => {
    const live = (each: Element) => {
      const politeness = each.getAttribute("aria-live");
      const role = each.getAttribute("role");
      return politeness === null ? role === "alert" || role === "status" : politeness !== "off";
    };
    const regions = [...document.querySelectorAll("*")].filter(
      (each) => live(each) && each.textContent.includes(wanted),
    );
    return regions.filter(
      (each) => !regions.some((other) => other !== each && other.contains(each)),
    ).length;
  }, text);
