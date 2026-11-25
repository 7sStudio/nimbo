// The feedback mode's state, on both pages: on or off, the note being written (the element or the dragged
// box it is about, and the screenshots taken as it was picked), and the saved entries the daemon keeps (feedbackApi.ts),
// which the mode pins on the page and the Feedback dialog lists. Esc closes the note first, then leaves the mode.
// A new note is listed and pinned the moment it is saved and stored at once without its screenshots, which follow in
// the background, the entry marked saving until then, and failed (with Retry) when the save did not go through.
import { defineStore } from "pinia";
import { computed, markRaw, ref, shallowRef, watch } from "vue";

import type {
  FeedbackDraft,
  FeedbackEntry,
  FeedbackStatus,
  Located,
  Rect,
  Shots,
} from "./feedbackApi.js";
import { feedbackApi } from "./feedbackApi.js";

/** The note being written: what it is about, and the screenshots, still being taken while `shots` is pending. */
export type Note = {
  readonly element: Element;
  /** What the entry records of the element, read as it was picked. */
  readonly located: Located;
  /** Set when the user dragged a box instead of clicking. */
  readonly area?: Rect;
  readonly shots: Promise<Shots>;
  /** Stops taking the screenshots: the note was closed without being saved. */
  readonly cancel?: () => void;
  /** The saved entry this note edits, when it was opened from a pin. */
  readonly entry?: FeedbackEntry;
};

type Unsaved = { readonly state: "saving" | "failed"; readonly error?: string };

type Pending = {
  readonly draft: FeedbackDraft;
  readonly shots: Promise<Shots>;
  /** Set once the note is stored without its screenshots. */
  stored?: true;
};

let localIds = 0;

type Change = { readonly status?: FeedbackStatus; readonly text?: string };

function withState(map: ReadonlyMap<string, Unsaved>, id: string, state?: Unsaved) {
  const next = new Map(map);
  if (state === undefined) next.delete(id);
  else next.set(id, state);
  return next;
}

const isLocal = (id: string): boolean => id.startsWith("local-");

export const useFeedbackStore = defineStore("feedback", () => {
  const on = ref(false);
  const note = shallowRef<Note | null>(null);
  let saved: Note | null = null;
  watch(note, (_, before) => {
    if (before !== null && before !== saved) before.cancel?.();
  });
  /** The entry whose note the layer opens next (the list's Show on Page). */
  const revealing = ref<string | null>(null);

  // The saved entries: read once the mode or the list first needs them, then kept as each change answers. New entries
  // show at once under a local id, and keep the daemon's id once their note is stored.
  const entries = shallowRef<readonly FeedbackEntry[]>([]);
  const dir = ref("");
  const loaded = ref(false);
  const unsaved = shallowRef<ReadonlyMap<string, Unsaved>>(new Map());
  const pending = new Map<string, Pending>();

  const mark = (id: string, state?: Unsaved) => {
    unsaved.value = withState(unsaved.value, id, state);
  };
  const replace = (id: string, entry: FeedbackEntry) => {
    entries.value = entries.value.map((each) => (each.id === id ? entry : each));
  };

  /** Stores the note at once without its screenshots, in a request that outlives the page, so that a reload or a close
   * right after saving cannot lose it; the entry takes the daemon's id. That id. */
  async function store(id: string, job: Pending) {
    const entry = await feedbackApi.add({ ...job.draft, shots: {} });
    job.stored = true;
    pending.delete(id);
    pending.set(entry.id, job);
    mark(id);
    mark(entry.id, { state: "saving" });
    replace(id, entry);
    return entry.id;
  }

  /** Sends the entry `first`: the note if it is not stored yet, then its screenshots once drawn. */
  async function send(first: string): Promise<void> {
    let id = first;
    const job = pending.get(id);
    if (job === undefined) return;
    mark(id, { state: "saving" });
    try {
      if (job.stored !== true) id = await store(id, job);
      const shots = await job.shots;
      if (shots.element !== undefined || shots.viewport !== undefined)
        replace(id, await feedbackApi.attach(id, shots));
      pending.delete(id);
      mark(id);
    } catch (error) {
      if (pending.get(id) === job)
        mark(id, {
          state: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      throw error;
    }
  }

  const add = (draft: FeedbackDraft, shots: Promise<Shots>): Promise<void> => {
    localIds += 1;
    const id = `local-${String(localIds)}`;
    pending.set(id, { draft, shots });
    const at = new Date().toISOString();
    entries.value = [{ ...draft, id, at, status: "open", shots: {} }, ...entries.value];
    return send(id);
  };

  return {
    on,
    note,
    revealing,
    entries,
    dir,
    loaded,
    unsaved,
    add,
    retry: (id: string): Promise<void> => send(id),
    open: computed(() => entries.value.filter((entry) => entry.status === "open")),
    load: async (): Promise<void> => {
      const list = await feedbackApi.list();
      entries.value = [
        ...entries.value.filter((entry) => pending.has(entry.id)),
        ...list.entries.filter((entry) => !pending.has(entry.id)),
      ];
      dir.value = list.dir;
      loaded.value = true;
    },
    change: async (id: string, change: Change): Promise<void> => {
      const entry = await feedbackApi.change(id, change);
      entries.value = entries.value.map((each) => (each.id === entry.id ? entry : each));
    },
    remove: async (id: string): Promise<void> => {
      if (pending.has(id)) {
        // an entry still being stored cannot be removed yet
        if (isLocal(id) && unsaved.value.get(id)?.state === "saving") return;
        pending.delete(id);
        mark(id);
      }
      if (!isLocal(id)) await feedbackApi.remove(id);
      entries.value = entries.value.filter((entry) => entry.id !== id);
    },
    submit: (draft: FeedbackDraft): Promise<void> => {
      saved = note.value;
      note.value = null;
      return saved === null ? Promise.resolve() : add(draft, saved.shots);
    },
    toggle: () => {
      on.value = !on.value;
      if (!on.value) note.value = null;
    },
    pick: (picked: Note) => {
      note.value = markRaw({ ...picked });
    },
    /** Esc's first step: true when a note was open. */
    closeNote: (): boolean => {
      if (note.value === null) return false;
      note.value = null;
      return true;
    },
    /** Esc's last step before the page's own: true when the mode was on. */
    stop: (): boolean => {
      if (!on.value) return false;
      on.value = false;
      note.value = null;
      return true;
    },
  };
});
