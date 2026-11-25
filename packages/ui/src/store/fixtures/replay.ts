// Reading and replaying the recorded logs: <flow>.jsonl holds the events as `nimbo events --follow` prints them, and
// <flow>.state.json the notebook.get state and seq the recording started from and the state it ended at.
import { readFileSync } from "node:fs";

import type { EventEnvelope, NotebookState } from "@jsnb/core";
import { EventEnvelope as EventSchema, NotebookState as StateSchema } from "@jsnb/core";

import { emptyMirror, hydrated } from "../mirror.js";
import type { Mirror } from "../mirror.js";
import { reduce } from "../reduce.js";

export type Recording = {
  readonly start: NotebookState;
  readonly startSeq: number;
  readonly end: NotebookState;
};

function recording(json: unknown): Recording {
  const record = typeof json === "object" && json !== null ? json : {};
  const startSeq: unknown = Reflect.get(record, "startSeq");
  if (typeof startSeq !== "number") throw new Error("a recording names its startSeq");
  const start = StateSchema.parse(Reflect.get(record, "start"));
  return { start, startSeq, end: StateSchema.parse(Reflect.get(record, "end")) };
}

const here = (name: string) => new URL(`./${name}`, import.meta.url);

/** One recorded flow: its start and end states and its events. */
export function readFixture(flow: string): Recording & { readonly events: EventEnvelope[] } {
  const recorded = recording(JSON.parse(readFileSync(here(`${flow}.state.json`), "utf8")));
  const events = readFileSync(here(`${flow}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => EventSchema.parse(JSON.parse(line)));
  return { ...recorded, events };
}

/** The mirror after hydrating `start` and applying `events`. */
export const replay = (
  start: NotebookState,
  startSeq: number,
  events: readonly EventEnvelope[],
): Mirror => events.reduce(reduce, hydrated(emptyMirror, start, startSeq));

/** What the reducer owns of a state: the cells without their last-run summary (fetched with cell.get), the kernel's
 * state and the realm's attachment. */
export const projection = (state: NotebookState) => ({
  path: state.path,
  kernel: state.kernel.state,
  realm: state.realm.attached,
  cells: state.cells.map(({ id, type, source, index, meta, status, stale }) => ({
    id,
    type,
    source,
    index,
    meta,
    status,
    stale,
  })),
});
