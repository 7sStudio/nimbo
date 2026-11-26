// The headless pages the daemon's notebooks share: its one headless browser, each page loaded from
// the daemon's own origin with the page cookie a tab gets on its first load, then started with the token over the
// browser's pipe; the token is never in a URL, a log or the browser's command line.
import type { CookieData } from "puppeteer-core";

import type { Log } from "../../events/log.js";
import type { HeadlessBrowser } from "../../kernel/headless/browser.js";
import { createHeadlessBrowser } from "../../kernel/headless/browser.js";
import type { GuardedPage } from "../../kernel/headless/page.js";

export type HeadlessService = {
  /** A new page holding `notebook`'s realm, attached once it resolves; `key` is the one-time key its attach carries. */
  readonly open: (notebook: string, key: string) => Promise<GuardedPage>;
  readonly stop: () => Promise<void>;
};

export type HeadlessCredentials = {
  /** The daemon's port, known once it listens. */
  readonly port: () => number;
  readonly token: string;
  /** The page cookie's value (http/auth.ts): what a tab holds after its first load. */
  readonly pageKey: string;
};

const pagePath = "/ui/headless.html";

/** The page cookie for `/ui/` and `/npm/`, as the daemon sets it on a tab's first load (http/auth.ts). */
const cookiesOf = (port: number, key: string): CookieData[] =>
  ["/ui/", "/npm/"].map((path) => ({
    name: `nimbo-${String(port)}`,
    value: key,
    domain: "127.0.0.1",
    path,
    httpOnly: true,
    secure: false,
    sameSite: "Strict",
  }));

export function createHeadlessService(options: {
  readonly dir: string;
  readonly log: Log;
  readonly credentials: HeadlessCredentials;
  readonly settings: () => { readonly browser: string | null; readonly sandbox: boolean };
}): HeadlessService {
  const { credentials, log } = options;
  const browser: HeadlessBrowser = createHeadlessBrowser({
    dir: options.dir,
    log,
    settings: options.settings,
  });
  return {
    open: async (notebook, key) => {
      const port = credentials.port();
      const origin = `http://127.0.0.1:${String(port)}`;
      const cookies = cookiesOf(port, credentials.pageKey);
      const page = await browser.open({ origin, path: pagePath, cookies });
      try {
        await page.startRealm({ token: credentials.token, notebook, key });
      } catch (error) {
        await page.close();
        throw error;
      }
      return page;
    },
    stop: () => browser.stop(),
  };
}
