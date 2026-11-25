// The client realm (02-architecture §2): one per notebook page, attached over the host's socket (03-api §4.5).
import type { RealmSnapshotAnswer } from "@jsnb/core";
import {
  RealmDispose,
  RealmEvent,
  RealmExecute,
  RealmInterrupt,
  RealmReset,
  RealmSnapshot,
  realmAttach,
} from "@jsnb/core";

import type * as SnapshotCode from "../display/agentSnapshot.js";
import { execute, retire } from "./execute.js";
import { listenForStrayErrors } from "./fallback.js";
import { interrupt } from "./interrupt.js";
import type { RealmOptions } from "./options.js";
import { resolveOptions } from "./options.js";
import { redact } from "./redact.js";
import type { RealmRequestMethod } from "./requests.js";
import { parseParams } from "./requests.js";
import { reset, resetQuietly } from "./reset.js";
import type { RealmState } from "./state.js";
import { createState } from "./state.js";

const notRendered = { text: "", rendered: false, truncated: false } as const;
/** realm.snapshot's cut when the daemon sends none. */
const defaultMaxBytes = 16_384;

let snapshotModule: Promise<typeof SnapshotCode> | undefined;

/** The snapshot code, out of the page's first load; a failed load is retried on the next request. */
function loadSnapshot(): Promise<typeof SnapshotCode> {
  snapshotModule ??= import("../display/agentSnapshot.js").catch((error: unknown) => {
    snapshotModule = undefined;
    throw new Error(
      `the page could not load its snapshot code: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  return snapshotModule;
}

/** The page's realm: runs client cells, owns their containers, and answers the daemon's requests. */
export class Realm {
  readonly #state: RealmState;

  constructor(options: RealmOptions) {
    this.#state = createState(resolveOptions(options));
  }

  /** `realm.attach { notebook, kind }`; a rejection propagates (the host shows the page view-only). With `takeover`
   * the page takes the notebook from the tab that holds it. */
  async attach(takeover = false): Promise<string> {
    const { notebook, kind, transport, attachKey } = this.#state.options;
    const params = {
      ...{ notebook, kind },
      ...(takeover ? { takeover } : {}),
      ...(attachKey === undefined ? {} : { key: attachKey }),
    };
    const { realmId } = realmAttach.output.parse(await transport.call("realm.attach", params));
    const { attachment } = this.#state;
    attachment.stopListening?.();
    attachment.stopListening = listenForStrayErrors(this.#state);
    attachment.realmId = realmId;
    return realmId;
  }

  /** The full local reset without reports, then `realm.detach { realmId }`. */
  async detach(): Promise<void> {
    const realmId = this.#release();
    if (realmId !== undefined)
      await this.#state.options.transport.call("realm.detach", { realmId });
  }

  /** The full local reset without reports, the page no longer attached; the realm id it had. */
  #release(): string | undefined {
    const { attachment } = this.#state;
    const { realmId } = attachment;
    resetQuietly(this.#state);
    attachment.stopListening?.();
    attachment.stopListening = undefined;
    attachment.realmId = undefined;
    return realmId;
  }

  /** The server → page requests; params that do not parse throw core's InvalidParams (-32602). */
  async handle(method: RealmRequestMethod, params: unknown): Promise<unknown> {
    switch (method) {
      case "realm.execute":
        return execute(this.#state, parseParams(RealmExecute, params));
      case "realm.reset": {
        const parsed = parseParams(RealmReset, params);
        // another tab took the notebook over: the daemon detached this page already
        if (parsed.takenOver === true) {
          this.#release();
          return {};
        }
        return reset(this.#state, parsed);
      }
      case "realm.snapshot":
        return this.#snapshot(parseParams(RealmSnapshot, params));
      case "realm.event":
        return this.#state.context.events.deliver(parseParams(RealmEvent, params));
      case "realm.dispose":
        this.#dispose(parseParams(RealmDispose, params).cell);
        return {};
      case "realm.interrupt":
        return interrupt(this.#state, parseParams(RealmInterrupt, params));
    }
  }

  /** The live container of a cell for the host's DomView; the host slots it and never recreates it. */
  containerOf(cell: string): HTMLElement | undefined {
    return this.#state.containers.get(cell);
  }

  async #snapshot({ cell, maxBytes, html }: RealmSnapshot): Promise<RealmSnapshotAnswer> {
    const container = this.#state.containers.get(cell);
    if (container === undefined) return notRendered;
    const { agentSnapshot } = await loadSnapshot();
    const shot = await agentSnapshot(container, {
      maxBytes: maxBytes ?? defaultMaxBytes,
      html: html === true,
    });
    const text = redact(shot.text);
    const truncated = shot.truncated;
    return shot.html === undefined
      ? { text, rendered: true, truncated }
      : { text, html: redact(shot.html), rendered: true, truncated };
  }

  /** A deleted cell: its cleanups run (a throw goes to `onError`, the cell has no run to show it), its run ends
   * `interrupted` if it was in progress, its container goes. */
  #dispose(cell: string): void {
    const run = this.#state.runs.get(cell);
    if (run) {
      run.disposers.run(this.#state.options.onError);
      retire(this.#state, run, true);
      this.#state.runs.delete(cell);
    }
    this.#state.containers.remove(cell);
  }
}
