// The client realm (02-architecture §2): one per notebook page, attached over the host's socket (03-api §4.5).
import { RealmExecute, RealmInterrupt, RealmReset, RealmSnapshot, realmAttach } from "@jsnb/core";

import { domSnapshot } from "../display/snapshot.js";
import { execute } from "./execute.js";
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

const empty = { html: "", text: "" } as const;

/** The page's realm: runs client cells, owns their containers, and answers the daemon's requests. */
export class Realm {
  readonly #state: RealmState;

  constructor(options: RealmOptions) {
    this.#state = createState(resolveOptions(options));
  }

  /** `realm.attach { notebook, kind }`; a rejection propagates (the host shows the page view-only). With `takeover`
   * the page takes the notebook from the tab that holds it. */
  async attach(takeover = false): Promise<string> {
    const { notebook, kind, transport } = this.#state.options;
    const { realmId } = realmAttach.output.parse(
      await transport.call("realm.attach", { notebook, kind, ...(takeover ? { takeover } : {}) }),
    );
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
        return this.#snapshot(parseParams(RealmSnapshot, params).cell);
      case "realm.interrupt":
        return interrupt(this.#state, parseParams(RealmInterrupt, params));
    }
  }

  /** The live container of a cell for the host's DomView; the host slots it and never recreates it. */
  containerOf(cell: string): HTMLElement | undefined {
    return this.#state.containers.get(cell);
  }

  #snapshot(cell: string): { readonly html: string; readonly text: string } {
    const container = this.#state.containers.get(cell);
    if (container === undefined) return empty;
    const { html, text } = domSnapshot(container);
    return { html: redact(html), text: redact(text) };
  }
}
