// A real page as a notebook's client realm (05-bridge §11, 09-testing §8): the test page (fixtures/realmPage/page.ts:
// runtime-web's Realm over @jsnb/client's socket) bundled into a UI folder the daemon serves at /ui/, and Chromium
// through Playwright to load it, so client cells run in a real browser against the real daemon and kernel.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { z } from "zod";

const pageEntry = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "realmPage", "page.ts");

const html = `<!doctype html>
<meta charset="utf-8">
<title>nimbo realm test page</title>
<script type="module" src="/ui/realm-page.js"></script>
`;

/** The headless realm's page of the ui package (packages/ui/headless.html's entry). */
const headlessEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "packages",
  "ui",
  "src",
  "realm",
  "headless.ts",
);

const headlessHtml = `<!doctype html>
<meta charset="utf-8">
<title>nimbo headless realm</title>
<script type="module" src="/ui/headless-page.js"></script>
`;

/** Bundles the ui's headless realm page into `dir` as `headless.html`, where the daemon's headless browser loads it. */
export async function buildHeadlessPage(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await build({
    entryPoints: [headlessEntry],
    outfile: join(dir, "headless-page.js"),
    ...{ bundle: true, format: "esm", platform: "browser", target: "es2024" },
    ...{ conditions: ["development"], logLevel: "silent" },
  });
  await writeFile(join(dir, "headless.html"), headlessHtml);
}

/** Bundles the test page into `dir`, a UI folder for startServer's `uiDir`. */
export async function buildRealmPage(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await build({
    entryPoints: [pageEntry],
    outfile: join(dir, "realm-page.js"),
    ...{ bundle: true, format: "esm", platform: "browser", target: "es2024" },
    ...{ conditions: ["development"], logLevel: "silent" },
  });
  await writeFile(join(dir, "index.html"), html);
}

const Attach = z.union([
  z.object({ ok: z.literal(true), realmId: z.string() }),
  z.object({ ok: z.literal(false), name: z.string(), code: z.unknown() }),
]);
export type Attach = z.infer<typeof Attach>;

export type RealmPage = {
  readonly page: Page;
  /** How the page's realm.attach went: its realmId, or the error's name and code (1011 for a second page). */
  readonly attached: Attach;
  /** The page's uncaught errors so far. */
  readonly errors: readonly string[];
  /** The text of `cell`'s container in the page, or null when the cell has none. */
  readonly containerText: (cell: string) => Promise<string | null>;
  /** Dispatches an event named `type` on `cell`'s container, as a user's action would reach a listener there. */
  readonly dispatch: (cell: string, type: string) => Promise<void>;
  /** Resolves once `cell`'s container reads `text`. */
  readonly untilText: (cell: string, text: string) => Promise<void>;
  /** realm.detach from the page, its socket kept. */
  readonly detach: () => Promise<void>;
  /** realm.attach again with the page's runs and stubs kept, as the ui's page does once its socket came back; answers
   * the new realmId. */
  readonly reattach: () => Promise<string>;
  /** realm.attach { takeover }: takes the notebook from the page that holds it; answers the new realmId. */
  readonly takeOver: () => Promise<string>;
  /** True once another page took the notebook over from this one (realm.reset { takenOver }). */
  readonly takenOver: () => Promise<boolean>;
  /** Closes the page, and with it its socket. */
  readonly close: () => Promise<void>;
};

export type RealmPages = {
  /**
   * Loads `/ui/<notebook>?token=…` from the daemon at `url` and waits for its attach; in a fresh browser context of its
   * own, or in `context` (two daemons' pages sharing one browser profile and its cookies).
   */
  readonly open: (
    daemon: { readonly url: string; readonly token: string },
    notebook: string,
    context?: BrowserContext,
  ) => Promise<RealmPage>;
  /** A browser context of its own, for pages opened together. */
  readonly newContext: () => Promise<BrowserContext>;
  readonly close: () => Promise<void>;
};

/** The page's own expression for `cell`'s container (a string: this side has no DOM types). */
const containerOf = (cell: string): string =>
  `document.querySelector(${JSON.stringify(`[data-jsnb-cell="${cell}"]`)})`;

/** What a test reads and does in the page's containers. */
function containers(page: Page): Pick<RealmPage, "containerText" | "dispatch" | "untilText"> {
  return {
    containerText: async (cell) =>
      z
        .string()
        .nullable()
        .parse(await page.evaluate(`${containerOf(cell)}?.textContent ?? null`)),
    dispatch: async (cell, type) => {
      await page.evaluate(
        `${containerOf(cell)}?.dispatchEvent(new Event(${JSON.stringify(type)}))`,
      );
    },
    untilText: async (cell, text) => {
      await page.waitForFunction(`${containerOf(cell)}?.textContent === ${JSON.stringify(text)}`);
    },
  };
}

/** A page in `context`; closing it closes the context too when the page owns it. */
async function openPage(
  where: { readonly context: BrowserContext; readonly owned: boolean },
  url: string,
  notebook: string,
): Promise<RealmPage> {
  const { context, owned } = where;
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url.replace("{notebook}", encodeURIComponent(notebook)));
  const attached = Attach.parse(await page.evaluate("window.jsnbRealm.attached"));
  return {
    page,
    attached,
    errors,
    ...containers(page),
    detach: async () => {
      await page.evaluate("window.jsnbRealm.detach()");
    },
    reattach: async () => z.string().parse(await page.evaluate("window.jsnbRealm.reattach()")),
    takeOver: async () => z.string().parse(await page.evaluate("window.jsnbRealm.takeOver()")),
    takenOver: async () => z.boolean().parse(await page.evaluate("window.jsnbRealm.takenOver()")),
    close: () => (owned ? context.close() : page.close()),
  };
}

/** One Chromium for a test file's pages; each page gets a context of its own unless one is given. */
export async function startRealmPages(): Promise<RealmPages> {
  const browser: Browser = await chromium.launch();
  return {
    open: async (daemon, notebook, context) =>
      openPage(
        context ? { context, owned: false } : { context: await browser.newContext(), owned: true },
        `${daemon.url}/ui/{notebook}?token=${daemon.token}`,
        notebook,
      ),
    newContext: () => browser.newContext(),
    close: () => browser.close(),
  };
}
