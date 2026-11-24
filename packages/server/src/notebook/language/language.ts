// The daemon's language service assembled: the worker started on first use, the calls
// over the notebooks' sessions, the LSP endpoint, and the pushes of cell.diagnostics for warm notebooks.
import { createRequire } from "node:module";
import { dirname } from "node:path";

import type { CellDiagnostics, CellId } from "@jsnb/core";

import type { EventBus } from "../../events/bus.js";
import type { Log } from "../../events/log.js";
import type { Session } from "../session/session.js";
import type { LspEndpoint } from "./lsp.js";
import { createLspEndpoint } from "./lsp.js";
import { createPusher } from "./push.js";
import type { LanguageCalls } from "./service.js";
import { createLanguageCalls } from "./service.js";
import type { WorkerOptions } from "./spawn.js";
import { createLanguageWorker } from "./spawn.js";

export type Language = Pick<LanguageCalls, "rename"> & {
  /** notebook.bridge: warms the notebook. */
  readonly bridge: LanguageCalls["bridge"];
  /** notebook.diagnostics: computed from the daemon's sources; warms the notebook. */
  readonly diagnostics: (notebook: string, cell?: CellId) => Promise<readonly CellDiagnostics[]>;
  /** language.lsp: warms the notebook. */
  readonly lsp: LspEndpoint;
  /** Hears a write of `.env`: its names may have changed. */
  readonly envChanged: () => void;
  readonly close: () => Promise<void>;
};

export type LanguageOptions = {
  readonly root: string;
  readonly bus: EventBus;
  readonly log: Log;
  readonly session: (notebook: string) => Promise<Session>;
  readonly envNames: () => Promise<{
    readonly server: readonly string[];
    readonly client: readonly string[];
  }>;
  readonly setting: (key: "editor.intellisense" | "editor.diagnostics") => boolean;
  readonly worker?: Pick<WorkerOptions, "onStart" | "memoryMb">;
};

/** The folder holding the daemon's own `@types/node`, so server cells have Node's types in any workspace. */
function daemonTypeRoots(): string[] {
  try {
    return [dirname(dirname(createRequire(import.meta.url).resolve("@types/node/package.json")))];
  } catch {
    return [];
  }
}

export function createLanguage(options: LanguageOptions): Language {
  const fallbackTypeRoots = daemonTypeRoots();
  const worker = createLanguageWorker({ root: options.root, fallbackTypeRoots, ...options.worker });
  const calls = createLanguageCalls({
    session: options.session,
    worker,
    envNames: options.envNames,
    intellisense: () => options.setting("editor.intellisense"),
  });
  const pusher = createPusher({
    bus: options.bus,
    log: options.log,
    compute: (notebook) => calls.diagnostics(notebook),
    close: (notebook) => void calls.close(notebook).catch(() => undefined),
    reset: () => void calls.reset().catch(() => undefined),
    idle: () => void worker.stop(),
    enabled: () => options.setting("editor.diagnostics"),
  });
  const endpoint = createLspEndpoint(calls);
  return {
    diagnostics: async (notebook, cell) => {
      pusher.warm(notebook);
      const lists = await calls.diagnostics(notebook, cell);
      pusher.sent(notebook, lists);
      return lists;
    },
    lsp: {
      handle: (notebook, ...rest) => (pusher.warm(notebook), endpoint.handle(notebook, ...rest)),
    },
    rename: (request, editor) => (pusher.warm(request.notebook), calls.rename(request, editor)),
    bridge: (notebook) => (pusher.warm(notebook), calls.bridge(notebook)),
    envChanged: pusher.everyWarm,
    close: async () => {
      pusher.stop();
      await worker.stop();
    },
  };
}
