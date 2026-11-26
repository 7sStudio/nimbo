// The state of one Realm: the record, the current run of every cell, containers, filenames, env and reports.
import type { Containers } from "../display/containers.js";
import { createContainers } from "../display/containers.js";
import type { ClientEnv } from "./env.js";
import { createEnv } from "./env.js";
import { errorInfo } from "./errors.js";
import type { CellFiles } from "./files.js";
import { createCellFiles } from "./files.js";
import { exposeRecord } from "./debugScope.js";
import { framesOf, userStackOf } from "./frames.js";
import { createEventListeners } from "./events.js";
import { createListenerRegistry } from "./listeners.js";
import { loadModule } from "./imports.js";
import type { ResolvedOptions } from "./options.js";
import type { Reports } from "./reports.js";
import { createReports } from "./reports.js";
import type { Run, RunContext } from "./run.js";

type Attachment = { realmId: string | undefined; stopListening: (() => void) | undefined };

export type RealmState = {
  readonly options: ResolvedOptions;
  readonly attachment: Attachment;
  /** The realm's one record of the names client cells define (null prototype, never `window`). */
  readonly record: Record<string, unknown>;
  /** The current run of each cell; any other run is stale. */
  readonly runs: Map<string, Run>;
  readonly containers: Containers;
  readonly files: CellFiles;
  readonly env: ClientEnv;
  readonly reports: Reports;
  readonly context: RunContext;
};

export function createState(options: ResolvedOptions): RealmState {
  const attachment: Attachment = { realmId: undefined, stopListening: undefined };
  const record: Record<string, unknown> = { __proto__: null };
  exposeRecord(record);
  const containers = createContainers(options.mount);
  const files = createCellFiles();
  const env = createEnv();
  const reports = createReports(options.transport, () => attachment.realmId, options.onError);
  const context: RunContext = {
    notebook: options.notebook,
    transport: options.transport,
    record,
    env: env.env,
    containers,
    listeners: createListenerRegistry(),
    events: createEventListeners(),
    reports,
    importModule: (specifier) => loadModule(options.importUrl(specifier)),
    pauses: options.pauses,
    errorInfo: (error) =>
      errorInfo(error, {
        frames: (stack) => framesOf(stack, files),
        userStack: (stack) => userStackOf(stack, files),
      }),
  };
  return { options, attachment, record, runs: new Map(), containers, files, env, reports, context };
}
