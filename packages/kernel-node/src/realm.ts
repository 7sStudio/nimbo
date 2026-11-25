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

type Outputs = Pick<
  Realm,
  "environment" | "sink" | "compiler" | "errorInfo" | "logErrorInfo" | "reportError"
>;

function createOutputs(deps: RealmDeps): Outputs {
  const environment = createEnvironment(deps.workspace, deps.processEnv);
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
    maxStreamBytes: deps.config.limits.maxStreamBytes,
    schedule: deps.schedule,
  });
  const frames = {
    ...{ mapFor: compiler.mapFor, cellOf: compiler.cellOf, cellUrls: compiler.cellUrls },
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
      notebook: deps.config.notebook,
      error: logErrorInfo(error),
    });
    deps.log("stderr", `${line}\n`);
  };
  return { environment, sink, compiler, errorInfo, logErrorInfo, reportError };
}

/** The kernel log notice of a deleted cell's cleanup that threw: no cell can show it any more. */
export function logCleanupFailure(
  deps: Pick<RealmDeps, "config" | "log">,
  cell: CellId,
  error: ErrorInfo,
): void {
  const detail = { level: "error", notebook: deps.config.notebook, cell, error };
  deps.log("stderr", `${notice("a cleanup of a deleted cell failed", detail)}\n`);
}

type Tables = Pick<Realm, "stores" | "names" | "exports" | "disposers" | "routes">;

function createTables(deps: RealmDeps, outputs: Outputs): Tables {
  const stores = createStores();
  const disposers = createDisposers((cell, error) => {
    logCleanupFailure(deps, cell, outputs.logErrorInfo(error));
  });
  const routes = createRoutes({
    routeBase: deps.config.routeBase,
    currentStore: stores.current,
    addDisposer: disposers.add,
    retired: disposers.retired,
    now: deps.clock,
    onChange: () => {
      deps.send({ type: "routes", routes: routes.list() });
    },
  });
  return { stores, names: createNames(), exports: createExports(), disposers, routes };
}

type Checks = Pick<Realm, "checkHooks" | "recheckHooks">;

/** The process-hook checks of 04-kernel §3.3, reporting on the realm's sink and log (hookReports.ts). */
function createChecks(deps: RealmDeps, outputs: Outputs, tables: Tables): Checks {
  const { hooks, log, exit } = deps;
  const { check, recheck } = createHookChecks({
    ...{ hooks, notebook: deps.config.notebook, log, exit, stores: tables.stores },
    ...{ sink: outputs.sink, errorInfo: outputs.errorInfo },
  });
  return { checkHooks: check, recheckHooks: recheck };
}

/** Builds the realm and reads `.env` once. */
export function createRealm(deps: RealmDeps): Realm {
  const outputs = createOutputs(deps);
  const tables = createTables(deps, outputs);
  const { stores, names, exports } = tables;
  const checks = createChecks(deps, outputs, tables);
  const { environment } = outputs;
  const builtins = createBuiltins({
    ...tables,
    ...outputs,
    afterCallback: (store) => {
      void checks.checkHooks(store);
    },
    workspace: deps.workspace,
    log: deps.log,
    events: { ...deps, maxBytes: deps.config.limits.maxBytesPerValue },
    encode: (value) =>
      encode(value, { maxBytes: deps.config.limits.maxValueBytes, redact: environment.redact })
        .json,
  });
  const scope = createScope({
    builtins: builtins.layer,
    plumbing: {
      __import: createImport({ workspace: deps.workspace, load: deps.load }),
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
  return { ...deps, ...outputs, ...tables, scope, builtins, ...checks, lastExecution: new Map() };
}
