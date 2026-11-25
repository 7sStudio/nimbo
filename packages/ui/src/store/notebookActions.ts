// The notebook store's command actions: each sends one registry command for the notebook the page shows.
// Runs do not wait; their progress arrives as events. A failure becomes a toast and the action resolves undefined
// (attempt.ts). Undo of a delete is undo.ts.
import type { Cell, CellId, CellPosition, CellType, Selection } from "@jsnb/core";
import { isJsnbError, languageLsp, languageRename, notebookBridge } from "@jsnb/core";
import type { SocketClient } from "@jsnb/client";

import type { Attempt } from "./attempt.js";
import { useUndoStore } from "./undo.js";

type Context = {
  readonly client: () => SocketClient;
  readonly notebook: () => string;
  readonly attempt: Attempt;
};

/** What cell.update may change from the page; meta.lastEdit is the server's (03-api §4.3). */
type CellPatch = Pick<
  Parameters<SocketClient["cell"]["update"]>[0],
  "source" | "type" | "meta" | "base"
>;

/** A RenameRefused the daemon answered: -32603 with the error's name in its data (03-api §7.4). */
function isRefusal(error: unknown): error is Error {
  if (!isJsnbError(error)) return false;
  const data: unknown = error.data;
  return (
    error.name === "RenameRefused" ||
    (typeof data === "object" && data !== null && "name" in data && data.name === "RenameRefused")
  );
}

/** `after` for moving `cell` one place up or down in `order`; undefined at either end. */
function neighbourAfter(
  order: readonly CellId[],
  cell: CellId,
  step: -1 | 1,
): CellId | null | undefined {
  const at = order.indexOf(cell);
  const target = at + step;
  if (at < 0 || target < 0 || target >= order.length) return undefined;
  return step === -1 ? (order[target - 1] ?? null) : (order[target] ?? null);
}

type Move = (
  cell: CellId,
  after: CellId | null,
) => Promise<{ readonly order: readonly CellId[] } | undefined>;

/** Where a move puts which cells: `ids` in order, the first after `after` (null: at the top), each next after the one
 * before it; undefined when there is nowhere to go. */
type MovePlan = { readonly ids: readonly CellId[]; readonly after: CellId | null } | undefined;

/** Moves, one after another, each planned from the order the previous one answered: quick ⌥↓ presses each move the
 * cell one more place, while the events of the earlier moves may still be on their way to the store. A plan of several
 * cells (a collapsed section, store/sections.ts) is one move per cell. */
function stepper(move: Move) {
  let queue: Promise<unknown> = Promise.resolve();
  let answered: readonly CellId[] | null = null;
  let pending = 0;
  return (order: readonly Cell[], plan: (order: readonly CellId[]) => MovePlan) => {
    pending += 1;
    const next = queue.then(async () => {
      const planned = plan(answered ?? order.map((each) => each.id));
      let done: Awaited<ReturnType<Move>> = undefined;
      let after = planned?.after ?? null;
      for (const cell of planned?.ids ?? []) {
        done = await move(cell, after);
        if (done === undefined) break;
        answered = done.order;
        after = cell;
      }
      pending -= 1;
      if (pending === 0) answered = null;
      return done;
    });
    // a move that threw (attempt answers undefined, so none should) never stops the ones after it
    queue = next.catch(() => {
      pending = 0;
      answered = null;
    });
    return next;
  };
}

function runActions({ client, notebook, attempt }: Context) {
  return {
    /** Runs `cell`; `source`, the editor's text not yet sent, is saved and run at once (03-api §4.3), `base` the
     * textHash of the text it was typed on. */
    run: (cell: CellId, source?: string, base?: string) =>
      attempt(() =>
        client().cell.run({
          notebook: notebook(),
          cell,
          wait: false,
          ...(source === undefined ? {} : { source }),
          ...(base === undefined ? {} : { base }),
        }),
      ),
    runSelection: (select: Selection) =>
      attempt(() => client().notebook.run({ notebook: notebook(), select, wait: false })),
    /** notebook.clearOutputs: the cells' outputs and counts gone (every cell when none are named). */
    clearOutputs: (cells?: readonly CellId[]) =>
      attempt(() =>
        client().notebook.clearOutputs({
          notebook: notebook(),
          ...(cells === undefined ? {} : { cells: [...cells] }),
        }),
      ),
    interrupt: () => attempt(() => client().kernel.interrupt({ notebook: notebook() })),
    restart: (all = false) => attempt(() => client().kernel.restart({ notebook: notebook(), all })),
    save: (force = false) => attempt(() => client().notebook.save({ notebook: notebook(), force })),
    reload: () => attempt(() => client().notebook.reload({ notebook: notebook() })),
    /** cell.compare: the last run against the one before it; a failure is the dialog's own line. */
    compare: (cell: CellId) => client().cell.compare({ notebook: notebook(), cell }),
    /** kernel.scope of one realm; a failure (a lost socket) is the panel's own line, never a toast on every refresh. */
    scope: async (realm: "server" | "client") => {
      try {
        return await client().kernel.scope({ notebook: notebook(), realm });
      } catch (error) {
        return { failed: error instanceof Error ? error.message : String(error) };
      }
    },
    bindings: (cell: CellId) =>
      attempt(() => client().cell.bindings({ notebook: notebook(), cell })),
    outputValue: (cell: CellId, index: number, path = "$", offset = 0) =>
      attempt(() => client().cell.outputValue({ notebook: notebook(), cell, index, path, offset })),
  };
}

/** Deletes `cell`; resolves the daemon's answer and what an undo needs, or undefined when it failed. */
const deleter =
  ({ client, notebook, attempt }: Context) =>
  async (order: readonly Cell[], cell: CellId) => {
    const at = order.findIndex((each) => each.id === cell);
    const target = order[at];
    if (target === undefined) return undefined;
    const answer = await attempt(() => client().cell.delete({ notebook: notebook(), cell }));
    if (answer === undefined) return undefined;
    return { answer, deleted: { cell: target, after: order[at - 1]?.id ?? null } };
  };

function deleteActions(context: Context) {
  const undo = useUndoStore();
  const deleteOne = deleter(context);
  return {
    /** Deletes `cell` (the one before it in `order` is where an undo puts it back) and offers the undo. */
    remove: async (order: readonly Cell[], cell: CellId) => {
      const done = await deleteOne(order, cell);
      if (done !== undefined) undo.remember([done.deleted]);
      return done?.answer;
    },
    /** Deletes `ids` (a marked range, in order) bottom-up, so each one's place is still there when an undo of the
     * whole range puts it back; one toast offers that undo. */
    removeAll: async (order: readonly Cell[], ids: readonly CellId[]) => {
      const deleted = [];
      for (const cell of [...ids].reverse()) {
        const done = await deleteOne(order, cell);
        if (done !== undefined) deleted.push(done.deleted);
      }
      undo.remember(deleted);
      return deleted.length;
    },
  };
}

function cellActions({ client, notebook, attempt }: Context) {
  const cells = () => client().cell;
  const move = (cell: CellId, after: CellId | null) =>
    attempt(() => cells().move({ notebook: notebook(), cell, after }));
  const steps = stepper(move);
  return {
    update: (cell: CellId, patch: CellPatch) =>
      attempt(() => cells().update({ notebook: notebook(), cell, ...patch })),
    /** cell.revert: the code from before an agent's edits no one reviewed, put back by the server (03-api §4.3). */
    revert: (cell: CellId) => attempt(() => cells().revert({ notebook: notebook(), cell })),
    /** Adds a cell after `after` (null: at the top; undefined: at the end); resolves the new cell. */
    add: async (type: CellType, after?: CellId | null, source = "") =>
      (
        await attempt(() =>
          cells().add({
            notebook: notebook(),
            type,
            source,
            ...(after === undefined ? {} : { after }),
          }),
        )
      )?.cell,
    move,
    /** Moves `cell` one place up or down among `order`; nothing at either end. */
    moveBy: (order: readonly Cell[], cell: CellId, step: -1 | 1) =>
      steps(order, (ids) => {
        const after = neighbourAfter(ids, cell, step);
        return after === undefined ? undefined : { ids: [cell], after };
      }),
    /** Moves cells by a plan made from the latest order (a block of cells, a drop at a place). */
    movePlanned: steps,
  };
}

/** The language service's calls from the page. */
function languageActions({ client, notebook, attempt }: Context) {
  return {
    /** language.lsp: one LSP message of the page's client; the reply text, null for a notification. */
    lsp: async (message: string) =>
      (await client().call(languageLsp, { notebook: notebook(), message })).reply,
    /** notebook.bridge: the server cells' exports with TypeScript's signatures; null when the call fails (the panel
     * keeps what it read from the sources). */
    bridge: async () =>
      (
        await client()
          .call(notebookBridge, { notebook: notebook() })
          .catch(() => null)
      )?.exports ?? null,
    /** language.rename: the refusal's reason, or null once every cell changed; another failure is a toast. */
    rename: async (cell: CellId, position: CellPosition, newName: string) => {
      try {
        await client().call(languageRename, { notebook: notebook(), cell, position, newName });
        return null;
      } catch (error) {
        if (isRefusal(error)) return error.message;
        await attempt(() =>
          Promise.reject(error instanceof Error ? error : new Error(String(error))),
        );
        return null;
      }
    },
  };
}

export const notebookActions = (context: Context) => ({
  ...runActions(context),
  ...languageActions(context),
  ...cellActions(context),
  ...deleteActions(context),
});
