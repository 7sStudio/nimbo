// One headless page, guarded (02-architecture §8): its top frame loads the daemon's own origin only (any other document
// it navigates to is refused before it is fetched, and a top frame that ends up elsewhere closes the page), its frames
// and the cells' fetches go where a tab's may; the daemon keeps the page's CDP session, which a client-cell debugger
// would attach beside. It starts the realm through the page's entry with the token and the notebook passed over the
// browser's pipe, never in a URL, and takes a cell container's PNG for cell.snapshot. A navigation of the top frame
// elsewhere is aborted, so the page stays.
import type { CDPSession, CookieData, Page } from "puppeteer-core";
import { z } from "zod";

import type { Log } from "../../events/log.js";

export type PageTarget = {
  /** `http://127.0.0.1:<port>`: the only origin the page's top frame may load. */
  readonly origin: string;
  /** The path loaded first, below `origin`. */
  readonly path: string;
  /** The page cookies, set before the first load. */
  readonly cookies: readonly CookieData[];
};

export type Shot = {
  readonly data: string;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly cropped: boolean;
};

export type GuardedPage = {
  readonly page: Page;
  /** The daemon's own CDP session on the page. */
  readonly cdp: CDPSession;
  /** Aborted once the page closed, whoever closed it. */
  readonly closed: AbortSignal;
  readonly close: () => Promise<void>;
  /** The browser went, and the page with it. */
  readonly lost: () => void;
  /** Runs the page's entry: the realm connects with `token` and attaches as `notebook`'s headless realm. */
  readonly startRealm: (token: string, notebook: string) => Promise<void>;
  /** A PNG of the cell's container, scaled down until it fits `maxBytes`; undefined when it has no box. */
  readonly shoot: (cell: string, maxBytes: number) => Promise<Shot | "tooLarge" | undefined>;
};

const loadTimeoutMs = 20_000;
/** The largest side of a container taken, in CSS pixels. */
const maxSide = 4096;
const minScale = 0.05;

const sameOrigin = (url: string, origin: string): boolean => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

/** Pauses every document request; the top frame's go on only to `origin`. */
async function guardNavigation(cdp: CDPSession, origin: string, log: Log): Promise<void> {
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const top = frameTree.frame.id;
  cdp.on("Fetch.requestPaused", (event) => {
    const allowed = event.frameId !== top || sameOrigin(event.request.url, origin);
    if (!allowed)
      log.warn({ url: event.request.url }, "the headless page's navigation was refused");
    const answer = allowed
      ? cdp.send("Fetch.continueRequest", { requestId: event.requestId })
      : cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" });
    answer.catch(() => undefined);
  });
  await cdp.send("Fetch.enable", {
    patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }],
  });
}

const Box = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

/** Runs in the page: the box of the container of the cell named, a direct child of the body, in page coordinates. */
const boxSource = `(id) => {
  const container = [...document.body.children].find((each) => each.getAttribute("data-jsnb-cell") === id);
  if (container === undefined) return null;
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
}`;

async function boxOf(page: Page, cell: string): Promise<z.infer<typeof Box> | undefined> {
  const raw: unknown = await page.evaluate(`(${boxSource})(${JSON.stringify(cell)})`);
  return raw === null ? undefined : Box.parse(raw);
}

async function shoot(page: Page, cell: string, maxBytes: number) {
  const box = await boxOf(page, cell);
  if (box === undefined) return undefined;
  const width = Math.min(box.width, maxSide);
  const height = Math.min(box.height, maxSide);
  const cropped = width < box.width || height < box.height;
  let scale = 1;
  for (;;) {
    const data = await page.screenshot({
      type: "png",
      encoding: "base64",
      captureBeyondViewport: true,
      clip: { x: box.x, y: box.y, width, height, scale },
    });
    const bytes = Math.floor((data.length * 3) / 4);
    if (bytes <= maxBytes) {
      const size = { width: Math.round(width * scale), height: Math.round(height * scale) };
      return { data, ...size, scale, cropped };
    }
    if (scale <= minScale) return "tooLarge" as const;
    scale = Math.max(minScale, scale * Math.sqrt(maxBytes / bytes) * 0.9);
  }
}

/** Runs the page's entry with the token and the notebook: passed over the browser's pipe, never in a URL. */
async function startRealm(page: Page, token: string, notebook: string): Promise<void> {
  await page.waitForFunction(() => "__nimboHeadless" in globalThis, { timeout: loadTimeoutMs });
  await page.evaluate(
    `globalThis.__nimboHeadless(${JSON.stringify(token)}, ${JSON.stringify(notebook)})`,
  );
}

/** The guards on `page`, then `target` loaded; the daemon's CDP session on the page. */
async function load(
  page: Page,
  target: PageTarget,
  { log, close }: { readonly log: Log; readonly close: () => Promise<void> },
): Promise<CDPSession> {
  const cdp = await page.createCDPSession();
  await guardNavigation(cdp, target.origin, log);
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame() || sameOrigin(frame.url(), target.origin)) return;
    log.warn({ url: frame.url() }, "the headless page left the daemon's origin; it was closed");
    void close();
  });
  page.on("pageerror", (error) => {
    log.debug({ err: error }, "the headless page reported an error");
  });
  await page.browserContext().setCookie(...target.cookies);
  const response = await page.goto(`${target.origin}${target.path}`, {
    waitUntil: "load",
    timeout: loadTimeoutMs,
  });
  if (response?.ok() !== true)
    throw new Error(`the daemon answered ${String(response?.status())} for ${target.path}`);
  return cdp;
}

/** Loads `target` in `page` behind the guards; the page is closed when anything fails. */
export async function guardPage(
  page: Page,
  target: PageTarget,
  log: Log,
  onClose: () => void,
): Promise<GuardedPage> {
  const closed = new AbortController();
  const ended = (): void => {
    if (closed.signal.aborted) return;
    closed.abort();
    onClose();
  };
  page.once("close", ended);
  const close = async (): Promise<void> => {
    await page.close().catch(() => undefined);
    ended();
  };
  try {
    const cdp = await load(page, target, { log, close });
    return {
      ...{ page, cdp, closed: closed.signal, close, lost: ended },
      startRealm: (token, notebook) => startRealm(page, token, notebook),
      shoot: (cell, maxBytes) => shoot(page, cell, maxBytes),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
