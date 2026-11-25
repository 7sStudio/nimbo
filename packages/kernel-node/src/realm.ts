// The kernel's realm (04-kernel §3.3, §5, §7, §8): the scope and its built-ins layer, the sink, the disposers, the
// export and route tables and the compile cache, composed from the four layers by passing functions in.
import type { CellId, ErrorInfo, ExecutionId } from "@jsnb/core";
import { encode } from "@jsnb/core";

import type { Disposers } from "./builtins/disposers.js";
import { createDisposers } from "./builtins/disposers.js";
import { createImport } from "./builtins/imports.js";
import type { RouteTable } from "./builtins/routes.js";
import { createRoutes } from "./builtins/routes.js";
import type { Builtins } from "./builtinsLayer.js";
import { createBuiltins } from "./builtinsLayer.js";
import type { Compiler } from "./compile.js";
import { createCompiler } from "./compile.js";
import type { Environment, ProcessEnv } from "./environment.js";
import { createEnvironment } from "./environment.js";
import type { ChildConfig, KernelMessage } from "./ipc/messages.js";
import { notice } from "./ipc/notice.js";
import { toErrorInfo } from "./outputs/errors.js";
import { rewritePositions } from "./outputs/frames.js";
import type { Sink, StreamName } from "./outputs/sink.js";
import { createSink } from "./outputs/sink.js";
import type { CheckHooks } from "./hookReports.js";
import { createHookChecks } from "./hookReports.js";
import { kernelDirectories } from "./kernelFiles.js";
import type { ProcessHooks } from "./processHooks.js";
import type { Exports } from "./scope/exports.js";
import { createExports } from "./scope/exports.js";
import type { Names } from "./scope/names.js";
import { createNames } from "./scope/names.js";
import type { Scope } from "./scope/record.js";
import { createScope, exposeScope } from "./scope/record.js";
import type { Store, Stores } from "./store.js";
import { createStores } from "./store.js";

export type RealmDeps = {
  readonly config: ChildConfig;
  /** The workspace folder, the kernel's cwd. */
  readonly workspace: string;
  readonly processEnv: ProcessEnv;
  /** True for an execution the daemon ended as interrupted (the interrupt hook's set): its cell is never called. */
  readonly interrupted: (execution: ExecutionId) => boolean;
  readonly send: (message: KernelMessage) => void;
  /** Writes to the original stdout or stderr: the daemon's kernel log (04-kernel §5.1). */
  readonly log: (stream: StreamName, text: string) => void;
  /** The kernel's own `import()`. */
  readonly load: (url: string) => Promise<unknown>;
  /** The sink's flush timer: 16 ms in production. */
  readonly schedule: (flush: () => void) => void;
  /** Now as an ISO string (registeredAt, event outputs). */
  readonly clock: () => string;
  /** Node's own process.nextTick and process.emit, captured at start, and their check after user code (04-kernel §3.3). */
  readonly hooks: ProcessHooks;
  /** Ends the process at once, whatever is still being sent: a kernel that can no longer hear the daemon (04-kernel §3.3). */
  readonly exit: (code: number) => void;
};

export type Realm = RealmDeps & {
  readonly stores: Stores;
  readonly environment: Environment;
  readonly scope: Scope;
  readonly builtins: Builtins;
  readonly names: Names;
  readonly exports: Exports;
  readonly disposers: Disposers;
  readonly routes: RouteTable;
  readonly sink: Sink;
  readonly compiler: Compiler;
  /** The latest execution of each cell that ran: route handlers and bridge calls report on it. */
  readonly lastExecution: Map<CellId, ExecutionId>;
  /** The ErrorInfo of a thrown value: cell frames mapped, kernel frames dropped, everything redacted. */
  readonly errorInfo: (error: unknown) => ErrorInfo;
  /** The same for a kernel log notice, unredacted: the daemon side redacts every log line (04-kernel §10). */
  readonly logErrorInfo: (error: unknown) => ErrorInfo;
  /** An error after its cell's run: an `error` output on the store's execution, or a log notice without one. */
  readonly reportError: (store: Store | undefined, error: unknown) => void;
  /** After user code that ran under a store, and on the interval: the hooks it may have replaced (hookReports.ts). */
  readonly checkHooks: CheckHooks;
  /** The interrupt hook's check: the same, and the replacements kept earlier probed again (04-kernel §3.3). */
  readonly recheckHooks: CheckHooks;
};

/** The kernel log notice of a deleted cell's cleanup that threw: no cell can show it any more. */
export function logCleanupFailure(
  deps: Pick<RealmDeps, "config" | "log">,
  cell: CellId,
  error: ErrorInfo,
): void {
  const detail = { level: "error", notebook: deps.config.notebook, cell, error };
  deps.log("stderr", `${notice("a cleanup of a deleted cell failed", detail)}\n`);
}

/** Builds the realm and reads `.env` once. */
export function createRealm(deps: RealmDeps): Realm {
  const { config, workspace, log } = deps;
  const environment = createEnvironment(workspace, deps.processEnv);
  const { redact } = environment;
  const compiler = createCompiler();
  const sink = createSink({
    send: (execution, output, full) => {
      deps.send(
        full ? { type: "output", execution, output, full } : { type: "output", execution, output },
      );
    },
    redact,
    rewrite: (text) => rewritePositions(text, compiler),
    maxStreamBytes: config.limits.maxStreamBytes,
    schedule: deps.schedule,
  });
  const frames = {
    mapFor: compiler.mapFor,
    cellOf: compiler.cellOf,
    cellUrls: compiler.cellUrls,
    internal: kernelDirectories,
  };
  const errorInfo = (error: unknown): ErrorInfo => toErrorInfo(error, { ...frames, redact });
  const logErrorInfo = (error: unknown): ErrorInfo =>
    toErrorInfo(error, { ...frames, redact: (text) => text });
  const reportError = (store: Store | undefined, error: unknown): void => {
    if (store) {
      sink.emit(store, { kind: "error", error: errorInfo(error) });
      return;
    }
    const line = notice("an error outside any cell", {
      level: "error",
      notebook: config.notebook,
      error: logErrorInfo(error),
    });
    log("stderr", `${line}\n`);
  };

  const stores = createStores();
  const disposers = createDisposers((cell, error) => {
    logCleanupFailure(deps, cell, logErrorInfo(error));
  });
  const routes = createRoutes({
    routeBase: config.routeBase,
    currentStore: stores.current,
    addDisposer: disposers.add,
    retired: disposers.retired,
    now: deps.clock,
    onChange: () => {
      deps.send({ type: "routes", routes: routes.list() });
    },
  });
  const names = createNames();
  const exports = createExports();

  const { check: checkHooks, recheck: recheckHooks } = createHookChecks({
    hooks: deps.hooks,
    notebook: config.notebook,
    log,
    exit: deps.exit,
    stores,
    sink,
    errorInfo,
  });
  const builtins = createBuiltins({
    workspace,
    stores,
    sink,
    environment,
    routes,
    disposers,
    log,
    reportError,
    afterCallback: (store) => {
      void checkHooks(store);
    },
    encode: (value) => encode(value, { maxBytes: config.limits.maxValueBytes, redact }).json,
    events: {
      send: deps.send,
      schedule: deps.schedule,
      clock: deps.clock,
      maxBytes: config.limits.maxBytesPerValue,
    },
  });
  const scope = createScope({
    builtins: builtins.layer,
    plumbing: {
      __import: createImport({ workspace, load: deps.load }),
      __export: (name, from = name) => {
        const store = stores.current();
        if (store) exports.register(name, from, store.cell);
      },
    },
    onCreate: (name) => {
      const store = stores.current();
      if (store) names.created(name, store.cell);
    },
  });
  exposeScope(scope.record);
  return {
    ...deps,
    environment,
    sink,
    compiler,
    errorInfo,
    logErrorInfo,
    reportError,
    stores,
    names,
    exports,
    disposers,
    routes,
    scope,
    builtins,
    checkHooks,
    recheckHooks,
    lastExecution: new Map(),
  };
}
