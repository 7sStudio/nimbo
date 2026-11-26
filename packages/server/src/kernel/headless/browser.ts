// The daemon's headless browser (02-architecture §7, §8): at most one per daemon, the system's Chrome, Chromium or Edge
// (launch.ts), launched on the first page asked for and closed with the last one, in a fresh profile removed when it
// closes. Its pipe is its leash: a daemon that dies, even by SIGKILL, closes it and Chrome exits. A launch that fails or
// hangs, or a browser that exits before it served a page, waits a growing delay before the next launch (2 s doubling up
// to a minute), so a browser that cannot start is not started in a loop; one killed after it served starts again at
// the next need. A page that does not close when told gets the whole browser killed. The stop kills a launch in flight
// and waits, bounded, for every browser it ends to exit and its profile to go.
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "puppeteer-core";

import type { Log } from "../../events/log.js";
import { findBrowser } from "./executable.js";
import type { Launched } from "./launch.js";
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
  readonly launched: Launched;
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
  /** Aborted by the stop: a launch in flight is killed. */
  readonly stopping: AbortController;
  /** The ends under way (a close, a kill and the profile's removal), which the stop waits for. */
  readonly ending: Set<Promise<void>>;
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

/** Runs `work` as one of the ends the stop waits for. */
function tracked(state: State, work: Promise<void>): Promise<void> {
  const done = work.catch((error: unknown) => {
    state.options.log.warn({ err: error }, "the headless browser did not end cleanly");
  });
  state.ending.add(done);
  void done.finally(() => state.ending.delete(done));
  return done;
}

/** Ends `own`: its pages are gone, the browser closed (killed when it does not obey), its profile removed. */
function finish(state: State, own: Running, why: string): Promise<void> {
  forget(state, own);
  if (own.closing) return Promise.resolve();
  own.closing = true;
  for (const page of own.pages) page.lost();
  own.pages.clear();
  return tracked(
    state,
    end(own.launched).then(() => {
      state.options.log.info({ why }, "the headless browser closed");
    }),
  );
}

function watch(state: State, own: Running): void {
  own.launched.browser.once("disconnected", () => {
    if (own.closing) return;
    state.options.log.warn({ served: own.served }, "the headless browser exited");
    if (!own.served)
      failed(state, new HeadlessFailed("the headless browser exited as it started."));
    void finish(state, own, "gone");
  });
}

/** Launches the browser; the stop waits for a launch in flight, which it kills. */
async function launchTracked(state: State, path: string, sandbox: boolean): Promise<Launched> {
  const { options, stopping } = state;
  const profile = await mkdtemp(join(options.dir, "profile-"));
  const launching = launch(path, profile, { sandbox, log: options.log, signal: stopping.signal });
  void tracked(
    state,
    launching.then(
      () => undefined,
      () => undefined,
    ),
  );
  try {
    return await launching;
  } catch (error) {
    throw error instanceof HeadlessFailed && !stopping.signal.aborted
      ? failed(state, error)
      : error;
  }
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
  const launched = await launchTracked(state, found.path, sandbox);
  if (state.stopped) {
    await tracked(state, end(launched));
    throw new HeadlessFailed("the daemon is stopping.");
  }
  backoff.failures = 0;
  backoff.retryAt = 0;
  const own: Running = { launched, pages: new Set(), closing: false, served: false };
  state.current = own;
  watch(state, own);
  const fields = { browserPid: launched.child.pid, path: found.path, sandbox };
  options.log.info(fields, "the headless browser started");
  return own;
}

/** The running browser, a new one when it is gone (killed before its disconnect was heard). */
async function browserOf(state: State): Promise<Running> {
  state.running ??= start(state).catch((error: unknown) => {
    state.running = undefined;
    throw error;
  });
  const own = await state.running;
  if (alive(own.launched)) return own;
  void finish(state, own, "gone");
  return browserOf(state);
}

/** Closes the browser once it holds no page and none is being opened. */
function release(state: State, own: Running): void {
  if (own.pages.size > 0 || state.opening > 0 || own.closing) return;
  void finish(state, own, "no page left");
}

/** A new page of the running browser, on a new one when it died before its disconnect was heard. */
async function newPage(state: State): Promise<{ readonly own: Running; readonly page: Page }> {
  const own = await browserOf(state);
  try {
    return { own, page: await own.launched.browser.newPage() };
  } catch (error) {
    if (alive(own.launched)) throw error;
    void finish(state, own, "gone");
    const next = await browserOf(state);
    return { own: next, page: await next.launched.browser.newPage() };
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
    const { log, dir } = state.options;
    const guarded = await guardPage(
      made.page,
      target,
      { log, dir },
      {
        closed: () => {
          holder.pages.delete(guarded);
          release(state, holder);
        },
        stuck: () => {
          state.options.log.warn({}, "a headless page did not close; its browser is killed");
          void finish(state, holder, "a page did not close");
        },
      },
    );
    own.pages.add(guarded);
    own.served = true;
    return guarded;
  } finally {
    state.opening -= 1;
    if (own) release(state, own);
  }
}

export function createHeadlessBrowser(options: HeadlessBrowserOptions): HeadlessBrowser {
  const prepared = prepareProfiles(options.dir, options.log);
  prepared.catch(() => undefined);
  const state: State = {
    options,
    prepared,
    running: undefined,
    current: undefined,
    opening: 0,
    stopped: false,
    stopping: new AbortController(),
    ending: new Set<Promise<void>>(),
    backoff: { failures: 0, retryAt: 0, last: "" },
  };
  return {
    open: (target) => open(state, target),
    stop: async () => {
      state.stopped = true;
      state.stopping.abort();
      if (state.current) void finish(state, state.current, "the daemon stops");
      await state.running?.catch(() => undefined);
      if (state.current) void finish(state, state.current, "the daemon stops");
      while (state.ending.size > 0) await Promise.all([...state.ending]);
    },
  };
}
