// One headless page, guarded (02-architecture §8): its top frame loads the daemon's own origin only (any other document
// it navigates to is refused before it is fetched, and a top frame that ends up elsewhere closes the page), its frames
// and the cells' fetches go where a tab's may; the daemon keeps the page's CDP session, and a client-cell debugger gets
// a relay of its own to the page (relay.ts). It starts the realm through the page's entry with the token, the notebook and a one-time key
// passed over the browser's pipe, never in a URL, and takes a cell container's PNG for cell.snapshot. Any navigation of
// the top frame after its first load is aborted, so the page stays; a page that does not close when told within 3 s is
// reported stuck, and its browser is killed.
import type { CDPSession, CookieData, Page } from "puppeteer-core";
import { z } from "zod";

import type { Log } from "../../events/log.js";
import type { CdpRelay } from "./relay.js";
import { openCdpRelay } from "./relay.js";

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

type RealmStart = {
  readonly token: string;
  readonly notebook: string;
  readonly key: string;
};

/** What the browser hears of a page: it closed, or it did not close when told (the browser is then killed). */
export type PageEnds = { readonly closed: () => void; readonly stuck: () => void };

export type GuardedPage = {
  readonly page: Page;
  /** The daemon's own CDP session on the page. */
  readonly cdp: CDPSession;
  /** Aborted once the page closed, whoever closed it. */
  readonly closed: AbortSignal;
  readonly close: () => Promise<void>;
  /** The browser went, and the page with it. */
  readonly lost: () => void;
  /** Runs the page's entry: the realm connects with `token` and attaches as `notebook`'s headless realm, with `key`, the
   * one-time key that tells the daemon its own page. */
  readonly startRealm: (start: RealmStart) => Promise<void>;
  /** A new CDP relay to this page for js-debug (relay.ts). */
  readonly relay: () => Promise<CdpRelay>;
  /** Ends the JavaScript the page runs now, or the next it runs: a page paused in the debugger ends what it paused in
   * once it resumes (the page answers only then, so this does not wait for it). */
  readonly terminate: () => void;
  /** A PNG of the cell's container, scaled down until it fits `maxBytes`; undefined when it has no box; "timeout" when
   * the page did not let itself be taken within `timeoutMs`. */
  readonly shoot: (
    cell: string,
    limits: { readonly maxBytes: number; readonly timeoutMs: number },
  ) => Promise<Shot | "tooLarge" | "timeout" | undefined>;
};

const loadTimeoutMs = 20_000;
/** How long a page has to close when told. */
const closeTimeoutMs = 3000;
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

/** Pauses every document request: the top frame loads `url` once and then nothing else (a reload or a link included);
 * the other frames' go on. */
async function guardNavigation(cdp: CDPSession, url: string, log: Log): Promise<void> {
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const top = frameTree.frame.id;
  let loaded = false;
  cdp.on("Fetch.requestPaused", (event) => {
    const first = !loaded && event.request.url === url;
    if (event.frameId === top && first) loaded = true;
    const allowed = event.frameId !== top || first;
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

async function shootAll(page: Page, cell: string, maxBytes: number) {
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

async function shoot(
  page: Page,
  cell: string,
  { maxBytes, timeoutMs }: { readonly maxBytes: number; readonly timeoutMs: number },
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
    }, timeoutMs);
  });
  const shot = shootAll(page, cell, maxBytes);
  shot.catch(() => undefined);
  try {
    return await Promise.race([shot, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs the page's entry with the token, the notebook and the one-time key: passed over the browser's pipe, never in a
 * URL. */
async function startRealm(page: Page, { token, notebook, key }: RealmStart): Promise<void> {
  await page.waitForFunction(() => "__nimboHeadless" in globalThis, { timeout: loadTimeoutMs });
  const args = [token, notebook, key].map((each) => JSON.stringify(each)).join(", ");
  await page.evaluate(`globalThis.__nimboHeadless(${args})`);
}

/** The guards on `page`, then `target` loaded; the daemon's CDP session on the page. */
async function load(
  page: Page,
  target: PageTarget,
  { log, close }: { readonly log: Log; readonly close: () => Promise<void> },
): Promise<CDPSession> {
  const cdp = await page.createCDPSession();
  await guardNavigation(cdp, `${target.origin}${target.path}`, log);
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
  options: { readonly log: Log; readonly dir: string },
  ends: PageEnds,
): Promise<GuardedPage> {
  const { log } = options;
  const closed = new AbortController();
  const ended = (): void => {
    if (closed.signal.aborted) return;
    closed.abort();
    ends.closed();
  };
  page.once("close", ended);
  // a call: the page may have closed while the close below was awaited
  const gone = (): boolean => closed.signal.aborted;
  const close = async (): Promise<void> => {
    if (gone()) return;
    const obeyed = await Promise.race([
      // a close that fails found the target gone already
      page.close().then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => setTimeout(resolve, closeTimeoutMs, false).unref()),
    ]);
    if (!obeyed && !gone()) ends.stuck();
    ended();
  };
  try {
    const cdp = await load(page, target, { log, close });
    return {
      page,
      cdp,
      closed: closed.signal,
      close,
      lost: ended,
      startRealm: (start) => startRealm(page, start),
      relay: () => openCdpRelay(page, { dir: options.dir, log }),
      terminate: () => {
        cdp.send("Runtime.terminateExecution").catch((error: unknown) => {
          log.debug({ err: error }, "the headless page did not take Runtime.terminateExecution");
        });
      },
      shoot: (cell, limits) => shoot(page, cell, limits),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
