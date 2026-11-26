// One `execute`: .env re-read, the cell compiled once per code, its disposers run, its exports
// cleared, `running` sent, the cell function awaited under its store, the names attributed, the process hooks
// checked, the streams flushed, the value output, the terminal status with its duration, then the export table.
// Every run sends exactly one terminal status: whatever a step of the kernel's own throws, or an await of its own
// rejects, ends the run as an error. A run the daemon ended as interrupted never calls its cell.
import { performance } from "node:perf_hooks";

import type { ErrorInfo } from "@jsnb/core";

import type { CellFunction } from "./compile.js";
import type { ExecuteMessage } from "./ipc/messages.js";
import { valueOutput } from "./outputs/value.js";
import type { Realm } from "./realm.js";
import { settle } from "./result.js";
import type { Store } from "./store.js";

type Terminal = {
  readonly status: "ok" | "error" | "interrupted";
  readonly error?: ErrorInfo;
  readonly durationMs: number;
};

/** What the run's store returns instead of the cell's promise when the cell is not called. */
const notCalled = Symbol("not called");

type Prepared =
  | { readonly ok: true; readonly fn: CellFunction }
  | { readonly ok: false; readonly error: unknown };

/** Re-reads `.env` (values, process.env, the redaction set) and compiles the cell; either may fail the run. */
function prepare(realm: Realm, message: ExecuteMessage): Prepared {
  try {
    realm.environment.reload();
  } catch (error) {
    // An unreadable .env ends this run with the read error; the next run reads it again.
    return { ok: false, error };
  }
  return realm.compiler.compile(message.cell, message.code, message.map);
}

/** The previous run's disposers, under the new run's store; each failure is an error output of the new run. */
async function runDisposers(realm: Realm, store: Store): Promise<void> {
  const failures = await realm.stores.run(store, () => realm.disposers.run(store.cell));
  for (const error of failures) realm.reportError(store, error);
}

/** The values `defines` had before the run, for the error-run attribution rule (scope/names.ts). */
function valuesBefore(record: Readonly<Record<string, unknown>>, defines: readonly string[]) {
  const before = new Map<string, unknown>();
  for (const name of defines) if (Object.hasOwn(record, name)) before.set(name, record[name]);
  return before;
}

/** A run that settled: its value output (none for undefined), or an error when the value cannot be shown. */
function shown(realm: Realm, store: Store, value: unknown, durationMs: number): Terminal {
  if (value === undefined) return { status: "ok", durationMs };
  try {
    const { output, full } = valueOutput(value, realm.config.limits, realm.environment.redact);
    realm.sink.emit(store, output, full);
    return { status: "ok", durationMs };
  } catch (error) {
    // A getter or a custom inspect that throws while the value is serialized fails the run with its error.
    return { status: "error", error: realm.errorInfo(error), durationMs };
  }
}

function finish(realm: Realm, store: Store, terminal: Terminal): void {
  realm.sink.flush(store.execution);
  realm.send({ type: "status", execution: store.execution, ...terminal });
  realm.send({ type: "exports", names: realm.exports.list() });
}

const failed = (realm: Realm, error: unknown, durationMs: number): Terminal => ({
  status: "error",
  error: realm.errorInfo(error),
  durationMs,
});

/** The run after its preparation: the disposers, the cell under its store, the names, the value; never throws. */
async function execute(
  realm: Realm,
  store: Store,
  message: ExecuteMessage,
  cellFunction: CellFunction,
): Promise<Terminal> {
  let started = performance.now();
  try {
    await runDisposers(realm, store);
    realm.exports.clear(store.cell);
    const { record } = realm.scope;
    const defines = message.defines ?? [];
    const before = valuesBefore(record, defines);
    started = performance.now();
    // `running`, then the interrupted check, are the last things the kernel does before the cell's code: an interrupt
    // the hook took while the kernel prepared the run is seen here, with nothing in between.
    const outcome = await settle(() =>
      realm.stores.run(store, () => {
        realm.send({
          type: "status",
          execution: store.execution,
          status: "running",
          durationMs: 0,
        });
        if (realm.interrupted(store.execution)) return notCalled;
        return cellFunction(record);
      }),
    );
    if (outcome.ok && outcome.value === notCalled) return { status: "interrupted", durationMs: 0 };
    const durationMs = performance.now() - started;
    const kinds = message.kinds ?? {};
    realm.names.attribute({ cell: store.cell, ok: outcome.ok, defines, kinds, before, record });
    if (outcome.ok) return shown(realm, store, outcome.value, durationMs);
    return failed(realm, outcome.error, durationMs);
  } catch (error) {
    // A step of the kernel's own failed: the run still ends, with that error.
    return failed(realm, error, performance.now() - started);
  }
}

/** Runs one cell to its terminal status; an execution already interrupted is not run. */
export async function runCell(realm: Realm, message: ExecuteMessage): Promise<void> {
  if (realm.interrupted(message.execution)) return;
  const store: Store = { cell: message.cell, execution: message.execution };
  realm.lastExecution.set(store.cell, store.execution);
  realm.disposers.revive(store.cell); // a deleted cell restored and run again registers again
  realm.sink.begin(store);
  let terminal: Terminal;
  try {
    const prepared = prepare(realm, message);
    terminal = prepared.ok
      ? await execute(realm, store, message, prepared.fn)
      : failed(realm, prepared.error, 0);
    // A process hook the cell replaced with one that does not deliver is put back before the run ends, so the
    // daemon's next message is heard.
    const checked = realm.checkHooks(store);
    if (checked) await checked;
  } catch (error) {
    // An await of the kernel's own failed: a cell broke the promise machinery it reads (Promise.prototype.constructor
    // replaced). The run still ends, with that error.
    terminal = failed(realm, error, 0);
  }
  finish(realm, store, terminal);
}
