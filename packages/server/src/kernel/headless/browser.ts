// The daemon's headless browser (02-architecture §7, §8): at most one per daemon, the system's Chrome, Chromium or Edge
// (launch.ts), launched on the first page asked for and closed with the last one, in a fresh profile removed when it
// closes. Its pipe is its leash: a daemon that dies, even by SIGKILL, closes it and Chrome exits. A launch that fails,
// or a browser that exits before it served a page, waits a growing delay before the next launch (2 s doubling up to a
// minute), so a browser that cannot start is not started in a loop; one killed after it served starts again at the
// next need.
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";

import type { Browser, Page } from "puppeteer-core";

import type { Log } from "../../events/log.js";
import { findBrowser } from "./executable.js";
import { alive, end, HeadlessFailed, launch, notFound, prepareProfiles } from "./launch.js";
import type { GuardedPage, PageTarget } from "./page.js";
import { guardPage } from "./page.js";

export { HeadlessFailed } from "./launch.js";

export type HeadlessBrowserOptions = {
  /** `.jsnb/headless/`: the profiles' folder, made 0700 on first use. */
  readonly dir: string;
  readonly log: Log;
  /** realm.headlessBrowser and realm.headlessSandbox, read at each launch. */
  readonly settings: () => { readonly browser: string | null; readonly sandbox: boolean };
};

export type HeadlessBrowser = {
  readonly open: (target: PageTarget) => Promise<GuardedPage>;
  readonly stop: () => Promise<void>;
};

type Running = {
  readonly browser: Browser;
  readonly profile: string;
  readonly pages: Set<GuardedPage>;
  closing: boolean;
  /** A page loaded in it: a browser that exits before any did failed to start. */
  served: boolean;
};

type State = {
  readonly options: HeadlessBrowserOptions;
  readonly prepared: Promise<void>;
  running: Promise<Running> | undefined;
  current: Running | undefined;
  opening: number;
  stopped: boolean;
  readonly backoff: { failures: number; retryAt: number; last: string };
};

const firstDelayMs = 2000;
const maxDelayMs = 60_000;

/** Notes a failed start: the next launch waits. */
function failed(state: State, error: HeadlessFailed): HeadlessFailed {
  const { backoff } = state;
  backoff.failures += 1;
  backoff.retryAt = Date.now() + Math.min(firstDelayMs * 2 ** (backoff.failures - 1), maxDelayMs);
  backoff.last = error.message;
  return error;
}

function forget(state: State, own: Running): void {
  if (state.current !== own) return;
  state.current = undefined;
  state.running = undefined;
}

function watch(state: State, own: Running): void {
  own.browser.once("disconnected", () => {
    forget(state, own);
    for (const page of own.pages) page.lost();
    own.pages.clear();
    if (own.closing) return;
    state.options.log.warn({ served: own.served }, "the headless browser exited");
    if (!own.served)
      failed(state, new HeadlessFailed("the headless browser exited as it started."));
    rmSync(own.profile, { recursive: true, force: true });
  });
}

async function start(state: State): Promise<Running> {
  const { options, backoff } = state;
  const wait = backoff.retryAt - Date.now();
  if (wait > 0)
    throw new HeadlessFailed(
      `${backoff.last.replace(/\.?$/u, ".")} It is tried again in ${String(Math.ceil(wait / 1000))} s.`,
    );
  const { browser: setting, sandbox } = options.settings();
  const found = findBrowser(setting);
  if (!found.found) throw notFound(setting, found.looked);
  await state.prepared;
  const profile = await mkdtemp(join(options.dir, "profile-"));
  const browser = await launch(found.path, profile, { sandbox, log: options.log }).catch(
    (error: unknown) => {
      throw error instanceof HeadlessFailed ? failed(state, error) : error;
    },
  );
  backoff.failures = 0;
  backoff.retryAt = 0;
  const own: Running = { browser, profile, pages: new Set(), closing: false, served: false };
  state.current = own;
  watch(state, own);
  const fields = { browserPid: browser.process()?.pid, path: found.path, sandbox };
  options.log.info(fields, "the headless browser started");
  return own;
}

/** The running browser, a new one when it is gone (killed before its disconnect was heard). */
async function launched(state: State): Promise<Running> {
  state.running ??= start(state).catch((error: unknown) => {
    state.running = undefined;
    throw error;
  });
  const own = await state.running;
  if (alive(own.browser)) return own;
  forget(state, own);
  return launched(state);
}

/** Closes the browser once it holds no page and none is being opened. */
async function release(state: State, own: Running): Promise<void> {
  if (own.pages.size > 0 || state.opening > 0 || own.closing) return;
  forget(state, own);
  own.closing = true;
  await end(own.browser, own.profile);
  state.options.log.info({}, "the headless browser closed");
}

/** A new page of the running browser, on a new one when it died before its disconnect was heard. */
async function newPage(state: State): Promise<{ readonly own: Running; readonly page: Page }> {
  const own = await launched(state);
  try {
    return { own, page: await own.browser.newPage() };
  } catch (error) {
    if (alive(own.browser)) throw error;
    forget(state, own);
    const next = await launched(state);
    return { own: next, page: await next.browser.newPage() };
  }
}

async function open(state: State, target: PageTarget): Promise<GuardedPage> {
  if (state.stopped) throw new HeadlessFailed("the daemon is stopping.");
  state.opening += 1;
  let own: Running | undefined;
  try {
    const made = await newPage(state);
    own = made.own;
    const holder = own;
    const guarded = await guardPage(made.page, target, state.options.log, () => {
      holder.pages.delete(guarded);
      void release(state, holder);
    });
    own.pages.add(guarded);
    own.served = true;
    return guarded;
  } finally {
    state.opening -= 1;
    if (own) void release(state, own);
  }
}

export function createHeadlessBrowser(options: HeadlessBrowserOptions): HeadlessBrowser {
  const prepared = prepareProfiles(options.dir, options.log);
  prepared.catch(() => undefined);
  const state: State = {
    ...{ options, prepared, running: undefined, current: undefined, opening: 0, stopped: false },
    backoff: { failures: 0, retryAt: 0, last: "" },
  };
  return {
    open: (target) => open(state, target),
    stop: async () => {
      state.stopped = true;
      const own = state.current ?? (await state.running?.catch(() => undefined));
      if (own === undefined) return;
      forget(state, own);
      own.closing = true;
      await end(own.browser, own.profile);
    },
  };
}
