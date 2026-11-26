// What a code cell can show at its lines' ends (editor/lineValues.ts places them): the server kernel's names with the
// preview of the value each holds now, in a short form, each in the cell that last set it only, where the value now is
// the one its last run left (another cell's later write would make it a value that cell's lines never produced). The
// page's own names are not read: the daemon knows only their names (a client binding's preview says "defined in the
// page"), so a client cell shows none. No tracing: when the cell's text changed since it ran, or its last run did not
// end well, it shows none.
import type { Binding, Cell, CellId } from "@jsnb/core";
import type { ShallowRef } from "vue";
import { computed, shallowRef, watch } from "vue";

import type { NamedValue } from "../editor/lineValues.js";
import { runsKey } from "../panel/useScope.js";
import type { useNotebookStore } from "../store/notebook.js";

/** The longest short form, before the editor cuts it further to the room left on the line. */
const budget = 40;

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** A string literal, a bracket or any other character, as `parts` steps over them. */
const token = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|[[\]{}(),]|[^'"`[\]{}(),]+/gsu;

/** The top-level parts of a bracketed list, `a: 1, b: [ 2, 3 ]` → `a: 1`, `b: [ 2, 3 ]`, quotes respected. */
function parts(inner: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let part = "";
  for (const [piece] of inner.matchAll(token)) {
    if (piece === "," && depth === 0) {
      found.push(part.trim());
      part = "";
      continue;
    }
    if ("[{(".includes(piece)) depth += 1;
    else if ("]})".includes(piece)) depth -= 1;
    part += piece;
  }
  if (part.trim() !== "") found.push(part.trim());
  return found;
}

const more = /^\.\.\. (\d+) more items?$/u;

/** `[ 1, 2, ... 2998 more items ]` → `Array(3000)`. */
function arrayShape(inner: string): string {
  const items = parts(inner);
  const rest = more.exec(items.at(-1) ?? "");
  return `Array(${String(rest === null ? items.length : items.length - 1 + Number(rest[1]))})`;
}

/** `{ id: 1, total: 2, … }` → `{id, total, …}`, as many keys as the budget holds. */
function objectShape(inner: string): string {
  const keys = parts(inner).map((each) =>
    each.startsWith("...") ? "…" : (/^(['"]?)([^:]*?)\1:/u.exec(each)?.[2] ?? each),
  );
  let shown: string[] = [];
  for (const key of keys) {
    if (key === "…") break;
    if ([...shown, key].join(", ").length + 4 > budget) break;
    shown = [...shown, key];
  }
  return shown.length === keys.length ? `{${shown.join(", ")}}` : `{${[...shown, "…"].join(", ")}}`;
}

/** A head's shape (`Stripe {…}`, `Map(2) {…}`), a string cut inside its quotes, anything else cut. */
function otherShape(preview: string): string {
  const headed = /^([\w$.]+(?:\(\d+\))?(?: \[[\w$]+\])?) [[{]/u.exec(preview);
  if (headed !== null) return `${cut(headed[1] ?? "", budget - 4)} {…}`;
  const quote = /^(['"`]).*\1$/su.exec(preview)?.[1];
  return quote === undefined
    ? cut(preview, budget)
    : `${cut(preview.slice(0, -1), budget - 1)}${quote}`;
}

/** A value's short form from its preview (util.inspect at depth 0): a short preview as it is, brackets tightened; a
 * long or elided array `Array(3000)`, a long object its keys `{id, total, …}`, an instance or a Map its head
 * `Stripe {…}`, `Map(2) {…}`, anything else cut. */
export function shortOf(preview: string): string {
  const array = /^\[ (.*) \]$/su.exec(preview)?.[1];
  const elided = array !== undefined && more.test(parts(array).at(-1) ?? "");
  const tight = preview.replace(/([[{]) /gu, "$1").replace(/ ([\]}])/gu, "$1");
  if (tight.length <= budget && !elided) return tight;
  if (array !== undefined) return arrayShape(array);
  const object = /^\{ (.*) \}$/su.exec(preview)?.[1];
  return object === undefined ? otherShape(preview) : objectShape(object);
}

/** A function or a class says nothing its declaration does not: its line shows no value. */
const callable = /^\[(?:Async|Generator|AsyncGenerator)?(?:Function|class)\b/u;

/** The values each server cell can show, by name, under the cell that last set them: each variable of the scope (not
 * its functions, classes or imports). */
export function valuesOf(
  bindings: readonly Binding[],
): ReadonlyMap<CellId, ReadonlyMap<string, NamedValue>> {
  const byCell = new Map<CellId, Map<string, NamedValue>>();
  for (const binding of bindings) {
    if (!["const", "let", "var"].includes(binding.kind) || callable.test(binding.preview)) continue;
    const values = byCell.get(binding.definedBy) ?? new Map<string, NamedValue>();
    byCell.set(binding.definedBy, values);
    values.set(binding.name, {
      name: binding.name,
      text: shortOf(binding.preview),
      full: binding.preview,
    });
  }
  return byCell;
}

/** The server kernel's values by the cell that last set them, read again after every run settles; none while `on` is
 * false or the notebook has no server cell. */
export function useScopes(
  store: ReturnType<typeof useNotebookStore>,
  on: () => boolean = () => true,
): ShallowRef<ReadonlyMap<CellId, ReadonlyMap<string, NamedValue>>> {
  const values = shallowRef<ReadonlyMap<CellId, ReadonlyMap<string, NamedValue>>>(new Map());
  let asked = 0;
  const servers = computed(() => store.cellsInOrder.some((cell) => cell.type === "server"));
  // Side effect: the server's scope is read when the notebook settles after a run, as the Variables group does.
  watch(
    () => (servers.value && on() ? runsKey(store) : null),
    async (key) => {
      if (key === null) return;
      asked += 1;
      const mine = asked;
      const answer = await store.scope("server");
      if (mine !== asked || !("bindings" in answer)) return;
      values.value = valuesOf(answer.bindings);
    },
    { immediate: true },
  );
  return values;
}

/** Whether `cell`'s text is the one its last run ran and that run ended well: only then do its lines show values. */
export const showsValues = (cell: Pick<Cell, "status" | "type">, edited: boolean): boolean =>
  cell.type === "server" && cell.status === "ok" && !edited;
