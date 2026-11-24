// The Home flow recorded into home.jsonl and its replay: an agent creates two notebooks, runs a cell
// that stays busy in one, closes it, renames the other closed and deletes it, then opens a third; the page's reducer
// replays the workspace stream from workspace.info's first list.
import { readFileSync } from "node:fs";

import type { EventEnvelope, NotebookEntry } from "@jsnb/core";
import { EventEnvelope as EventSchema, NotebookList } from "@jsnb/core";
import type { Daemon } from "@jsnb/test-daemon";

import type { HomeState } from "../homeReduce.js";
import { emptyHome, reduceHome, withList } from "../homeReduce.js";

export async function homeFlow({ client, events }: Daemon): Promise<void> {
  await client.notebook.create({ path: "a.jsnb" });
  await client.notebook.create({ path: "sub/b.jsnb" });
  const { cell } = await client.cell.add({
    notebook: "a.jsnb",
    type: "server",
    source: "await new Promise(() => {})",
  });
  await client.cell.run({ notebook: "a.jsnb", cell: cell.id, wait: false });
  await events.until(
    "kernel.status",
    (event) => event.notebook === "a.jsnb" && event.data.state === "busy",
  );
  await client.notebook.close({ notebook: "sub/b.jsnb" });
  await client.notebook.rename({ path: "sub/b.jsnb", to: "c.jsnb" });
  await client.notebook.close({ notebook: "a.jsnb" });
  await client.notebook.delete({ path: "a.jsnb" });
  await client.notebook.create({ path: "d.jsnb" });
  await events.until(
    "kernel.status",
    (event) => event.notebook === "d.jsnb" && event.data.state === "idle",
  );
}

/** The state after workspace.info's `start` list and `events`. */
export const replayHome = (
  start: readonly NotebookEntry[],
  events: readonly EventEnvelope[],
): HomeState => events.reduce(reduceHome, withList(emptyHome, start));

/** What the reducer owns that the daemon reports too: each notebook open or not, each open one's kernel state. */
export const homeProjection = (state: HomeState) => ({
  notebooks: state.notebooks.map(({ path, open }) => ({ path, open })),
  kernels: Object.fromEntries(
    Object.entries(state.kernels).map(([path, kernel]) => [path, kernel.state]),
  ),
});

/** The recorded flow: the first list and the events. */
export function readHomeFixture() {
  const here = (name: string) => new URL(`./${name}`, import.meta.url);
  const recorded: unknown = JSON.parse(readFileSync(here("home.state.json"), "utf8"));
  const start = NotebookList.parse(Reflect.get(Object(recorded), "start"));
  const end: unknown = Reflect.get(Object(recorded), "end");
  const events = readFileSync(here("home.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => EventSchema.parse(JSON.parse(line)));
  return { start, end, events };
}
