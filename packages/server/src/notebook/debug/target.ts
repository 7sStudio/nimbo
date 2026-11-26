// Where a notebook's js-debug attaches, per realm, each through a CDP relay of its own (kernel/debug/relay.ts): the
// kernel's inspector (the daemon's Node kernel, whose own code and Node's are skipped when stepping), or the headless
// page holding the client realm, the page's own code skipped. A page is known by its object: a new page is a new target.
import type { DebugRealm } from "@jsnb/core";
import { NotAvailable } from "@jsnb/core";
import { ownCodeDirectories } from "@jsnb/kernel-node";

import { openInspectorRelay } from "../../kernel/debug/inspectorRelay.js";
import type { GuardedPage } from "../../kernel/headless/page.js";
import type { SessionContext } from "../session/context.js";
import type { Dialect } from "./conditions.js";
import { dialects } from "./conditions.js";

/** What js-debug attaches to: its address, the code stepping skips, and what ends it. */
export type Opened = {
  /** Which target this is: an attach to another one replaces it. */
  readonly id: string;
  readonly url: string;
  readonly skipFiles: readonly string[];
  /** Ends what was opened for js-debug (the page's relay). */
  readonly close?: () => void;
  /** Aborted once the target went (the relay closed). */
  readonly gone?: AbortSignal;
};

export type DebugTarget = {
  readonly realm: DebugRealm;
  /** How logs and errors name it. */
  readonly name: string;
  readonly dialect: Dialect;
  /** The id of the target js-debug should be attached to now; undefined when there is none. */
  readonly current: () => string | undefined;
  /** Opens the current target for js-debug; NotAvailable when there is none. */
  readonly open: () => Promise<Opened>;
  /** js-debug died while the target was paused: true when the daemon resumed it itself. */
  readonly resumeLost: () => boolean;
};

const unavailable = (reason: string): NotAvailable =>
  new NotAvailable({ feature: "The debugger", reason });

export function kernelTarget(context: SessionContext): DebugTarget {
  return {
    realm: "server",
    name: "the kernel",
    dialect: dialects.server,
    current: () => context.kernel.status().inspectorUrl ?? undefined,
    open: async () => {
      const kernel = await context.kernel.running();
      const url = kernel.inspectorUrl();
      if (url === undefined) throw unavailable("the kernel has no inspector.");
      const skipFiles = [...ownCodeDirectories.map((dir) => `${dir}**`), "<node_internals>/**"];
      const relay = await openInspectorRelay(url, context.log);
      return { id: url, url: relay.url, skipFiles, close: relay.close, gone: relay.closed };
    },
    resumeLost: () => {
      const kernel = context.kernel.live();
      if (kernel?.paused() !== true) return false;
      kernel.resume();
      return true;
    },
  };
}

/** The page's own scripts (the realm's bundle, served under `/ui/`), skipped when stepping. */
const pageSkips = ["**/ui/**"];

export function pageTarget(page: () => GuardedPage | undefined): DebugTarget {
  const ids = new WeakMap<GuardedPage, string>();
  let made = 0;
  const idOf = (own: GuardedPage): string => {
    let id = ids.get(own);
    if (id === undefined) {
      made += 1;
      id = `page${String(made)}`;
      ids.set(own, id);
    }
    return id;
  };
  const live = (): GuardedPage | undefined => {
    const own = page();
    return own === undefined || own.closed.aborted ? undefined : own;
  };
  return {
    realm: "client",
    name: "the headless page",
    dialect: dialects.client,
    current: () => {
      const own = live();
      return own === undefined ? undefined : idOf(own);
    },
    open: async () => {
      const own = live();
      if (own === undefined)
        throw unavailable(
          "no headless page holds the client realm: client cells are debugged in the daemon's headless page (realm.headless on, no tab holding the notebook), which starts with a client cell's run.",
        );
      const relay = await own.relay();
      return {
        id: idOf(own),
        url: relay.url,
        skipFiles: pageSkips,
        close: relay.close,
        gone: relay.closed,
      };
    },
    resumeLost: () => false,
  };
}
