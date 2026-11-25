// The feedback notes as the commands of 03-api §4.12 read them, over the store /feedback/ serves (files/feedback): the
// notes listed for an agent (the screenshots as absolute paths, the bulky element details only with `full`) and one
// marked done or reworded.
import { join } from "node:path";

import type { FeedbackNote } from "@jsnb/core";
import { InvalidParams } from "@jsnb/core";

import type { FeedbackEntry } from "../../files/feedback/entry.js";
import { whereOf } from "../../files/feedback/entry.js";
import type { FeedbackStore } from "../../files/feedback/feedbackStore.js";

export type FeedbackNotes = {
  readonly list: (request: {
    readonly status: "open" | "done" | "all";
    readonly full: boolean;
  }) => Promise<{ readonly dir: string; readonly notes: readonly FeedbackNote[] }>;
  readonly update: (request: {
    readonly id: string;
    readonly status?: "open" | "done" | undefined;
    readonly text?: string | undefined;
  }) => Promise<{ readonly note: FeedbackNote }>;
};

/** The element, the component path and the area, which `full` adds. */
const detailsOf = (entry: FeedbackEntry) => ({
  element: entry.element,
  components: [...entry.components],
  ...(entry.area === undefined ? {} : { area: entry.area }),
});

/** An entry as a note: its screenshots in `dir`; with `full`, its details too. */
function noteOf(entry: FeedbackEntry, dir: string, full: boolean): FeedbackNote {
  const { cell, kind, path, notebook } = entry.page;
  const shots = Object.fromEntries(
    Object.entries(entry.shots).map(([which, name]) => [which, join(dir, name)]),
  );
  return {
    id: entry.id,
    at: entry.at,
    status: entry.status,
    text: entry.text,
    where: whereOf(entry),
    selector: entry.selector,
    shots,
    page: { kind, path, notebook, ...(cell === undefined ? {} : { cell }) },
    app: { version: entry.app.version, commit: entry.app.commit },
    ...(full ? detailsOf(entry) : {}),
  };
}

const issue = (path: string, message: string): InvalidParams =>
  new InvalidParams({ issues: [{ path: [path], message }] });

/** The notes over `store`. */
export function createFeedbackNotes(store: FeedbackStore): FeedbackNotes {
  return {
    list: async ({ status, full }) => {
      const entries = await store.list();
      const chosen = status === "all" ? entries : entries.filter((e) => e.status === status);
      return { dir: store.dir, notes: chosen.map((entry) => noteOf(entry, store.dir, full)) };
    },
    update: async ({ id, status, text }) => {
      if (status === undefined && text === undefined) throw issue("status", "Give status or text.");
      const changed = await store.change(id, {
        ...(status === undefined ? {} : { status }),
        ...(text === undefined ? {} : { text }),
      });
      if (changed === undefined)
        throw issue("id", `No feedback note ${id}. List them with feedback.list.`);
      if ("refused" in changed) throw issue("text", changed.refused);
      return { note: noteOf(changed.entry, store.dir, false) };
    },
  };
}
