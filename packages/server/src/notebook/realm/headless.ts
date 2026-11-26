// A session's headless realm: with realm.headless on and no page holding the
// notebook, a client run, a snapshot or a queued client run opens a page of the daemon's headless browser and waits for
// it to attach. A tab always wins: its attach takes the realm from the headless page (attach.ts), which is then closed,
// and no headless page starts while a tab holds the notebook. The page closes when it detaches (taken over, its socket
// gone, its browser gone), when the notebook closes or moves, and after realm.headlessIdleMs with no request to it, no
// report and no bridge call from it, while no client run is in flight and the debugger does not hold it (paused, or
// attached for client cells' breakpoints). js-debug leaves it before it closes, so a page paused there can close.
import { randomBytes, timingSafeEqual } from "node:crypto";

import { RealmNotAttached } from "@jsnb/core";

import { HeadlessFailed } from "../../kernel/headless/browser.js";
import type { GuardedPage } from "../../kernel/headless/page.js";
import type { SessionContext } from "../session/context.js";
import type { HeadlessService } from "./headlessService.js";
import type { PageSocket, RealmState } from "./state.js";

export type HeadlessRealm = {
  /** A page holds the realm once it settles: one already did, or the headless page attached; else RealmNotAttached. */
  readonly ensure: () => Promise<void>;
  /** Whether a run may count on a page: one is attached, or the headless realm can open one. */
  readonly available: () => boolean;
  /** Whether a `kind: "headless"` attach carrying `key` is this session's own page starting: the one-time key it was
   * given with the token, while it starts. */
  readonly expects: (key: string | undefined) => boolean;
  /** The headless page's socket as the realm keeps it: each request to it counts as use. */
  readonly wrap: (page: PageSocket) => PageSocket;
  /** A report or a bridge call from the page. */
  readonly touch: () => void;
  /** The headless page attached, or was detached. */
  readonly attached: (realmId: string) => void;
  readonly detached: (realmId: string) => void;
  /** The headless page, while one holds the realm. */
  readonly page: () => GuardedPage | undefined;
  /** The notebook moved: its headless page, attached under the old name, closes. */
  readonly moved: () => void;
  /** The page holding the realm did not answer a reset or an interrupt: a headless one is closed (its renderer with
   * it), and the next need opens a fresh one. */
  readonly unresponsive: () => void;
  /** realm.headless was turned off: the headless page closes. */
  readonly turnedOff: () => void;
  /** The notebook closes: its headless page closes, and none opens again. */
  readonly close: () => void;
};

type State = {
  readonly context: SessionContext;
  readonly realm: RealmState;
  readonly service: HeadlessService | undefined;
  readonly detach: (realmId: string, why: `headless:${string}`) => void;
  page: GuardedPage | undefined;
  /** The one-time key of the page starting. */
  key: string | undefined;
  realmId: string | undefined;
  starting: Promise<void> | undefined;
  idle: ReturnType<typeof setTimeout> | undefined;
  closed: boolean;
};

/** How long the headless page has to load and attach. */
const startTimeoutMs = 30_000;

const reasonOf = (error: unknown): string => {
  if (error instanceof HeadlessFailed) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return `its page did not start: ${message.split("\n")[0] ?? message}`;
};

/** Whether a page holds the realm (a call, so a check after an await is not narrowed away). */
const held = (realm: RealmState): boolean => realm.attachment !== undefined;

const enabled = (state: State): boolean =>
  state.service !== undefined && !state.closed && state.context.settings()["realm.headless"];

function shut(state: State, reason: string): void {
  clearTimeout(state.idle);
  state.idle = undefined;
  const { page, realmId } = state;
  state.page = undefined;
  state.realmId = undefined;
  if (realmId !== undefined) state.detach(realmId, `headless:${reason}`);
  if (page === undefined) return;
  state.context.log.info({ reason }, "the headless page closed");
  state.context.hooks.pageDebug.closing();
  void page.close();
}

function touch(state: State): void {
  if (state.page === undefined) return;
  clearTimeout(state.idle);
  state.idle = setTimeout(() => {
    if (state.realm.running.size > 0 || state.context.hooks.pageDebug.held()) touch(state);
    else shut(state, "idle");
  }, state.context.settings()["realm.headlessIdleMs"]);
  state.idle.unref();
}

/** Whether `given` is the key of the page starting, compared in constant time. */
function isKey(state: State, given: string | undefined): boolean {
  if (state.starting === undefined || state.key === undefined || given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(state.key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Opens the page and keeps it once it attached; a tab that attached meanwhile holds the realm instead. */
async function start(state: State, service: HeadlessService): Promise<void> {
  const { context, realm } = state;
  state.key = randomBytes(32).toString("base64url");
  const opened = service.open(context.ref, state.key);
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => {
      const late = `its page did not attach within ${String(startTimeoutMs / 1000)} s.`;
      reject(new HeadlessFailed(late));
    }, startTimeoutMs).unref();
  });
  try {
    const own = await Promise.race([opened, timeout]);
    if (state.closed || realm.attachment?.kind !== "headless" || state.page !== undefined) {
      await own.close();
      return;
    }
    state.page = own;
    own.closed.addEventListener("abort", () => {
      if (state.page === own) shut(state, "gone");
    });
    touch(state);
  } catch (error) {
    void opened.then((late) => late.close()).catch(() => undefined);
    if (realm.attachment !== undefined) return;
    throw new RealmNotAttached(
      { notebook: context.ref, headless: reasonOf(error) },
      { cause: error },
    );
  }
}

async function ensure(state: State): Promise<void> {
  const { context, realm, service } = state;
  if (realm.attachment !== undefined) {
    if (realm.attachment.kind === "headless") touch(state);
    return;
  }
  if (service === undefined || !enabled(state))
    throw new RealmNotAttached({ notebook: context.ref });
  state.starting ??= start(state, service).finally(() => {
    state.starting = undefined;
    state.key = undefined;
  });
  await state.starting;
  if (held(realm)) return; // the headless page, or a tab that attached meanwhile
  throw new RealmNotAttached({ notebook: context.ref, headless: "its page closed as it started." });
}

export function createHeadlessRealm(
  context: SessionContext,
  realm: RealmState,
  service: HeadlessService | undefined,
  detach: (realmId: string, why: `headless:${string}`) => void,
): HeadlessRealm {
  const state: State = {
    context,
    realm,
    service,
    detach,
    page: undefined,
    key: undefined,
    realmId: undefined,
    starting: undefined,
    idle: undefined,
    closed: false,
  };
  return {
    ensure: () => ensure(state),
    available: () => realm.attachment !== undefined || enabled(state),
    expects: (key) => isKey(state, key),
    wrap: (socket) => ({
      request: (method, params, signal) => {
        touch(state);
        return socket.request(method, params, signal);
      },
      closed: socket.closed,
    }),
    touch: () => {
      touch(state);
    },
    attached: (id) => {
      state.realmId = id;
    },
    detached: (id) => {
      if (state.realmId === id) shut(state, "detached");
    },
    page: () => state.page,
    moved: () => {
      shut(state, "moved");
    },
    unresponsive: () => {
      if (state.page !== undefined) shut(state, "unresponsive");
    },
    turnedOff: () => {
      shut(state, "turned off");
    },
    close: () => {
      state.closed = true;
      shut(state, "closed");
    },
  };
}
