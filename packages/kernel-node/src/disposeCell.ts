// A `dispose` request (04-kernel §2.1, §7): the cell was deleted (03-api cell.delete), so the cleanups it registered run
// now, as they would before a re-run that will never come: its routes leave the table (a `routes` message follows),
// its timers and listeners stop, and the cell is retired, so what its code still registers after an await (a run
// interrupted while it awaited resumes) is disposed at once until the cell runs again. They run under the cell's last
// store, and a failure, which no cell can show any more, is a notice in the kernel log. The scope it defined stays, as
// Jupyter keeps a deleted cell's names.
import type { CellId } from "@jsnb/core";

import type { DisposeMessage } from "./ipc/messages.js";
import type { Realm } from "./realm.js";
import { logCleanupFailure } from "./realm.js";
import type { ResultFields } from "./result.js";
import { reply } from "./result.js";

/** Retires the cell and runs its disposers under its last store (none when it never ran here), logging failures. */
async function retire(realm: Realm, cell: CellId): Promise<void> {
  const execution = realm.lastExecution.get(cell);
  const store = execution === undefined ? undefined : { cell, execution };
  const failures = await realm.stores.run(store, () => realm.disposers.retire(cell));
  for (const error of failures) logCleanupFailure(realm, cell, realm.logErrorInfo(error));
}

/**
 * Retires the deleted cell, runs its disposers and answers once they settled, with exactly one result whatever its
 * own steps throw. A cell that never ran in this kernel has an empty list: it is retired all the same, so a run of
 * it that was on its way registers nothing until the cell runs again.
 */
export async function disposeFlow(realm: Realm, message: DisposeMessage): Promise<void> {
  let fields: ResultFields;
  try {
    await retire(realm, message.cell);
    const checked = realm.checkHooks(undefined);
    if (checked) await checked;
    fields = { value: null };
  } catch (error) {
    // A step of the kernel's own failed: the request gets that error.
    fields = { error: realm.errorInfo(error) };
  }
  reply(realm.send, message.id, fields);
}
