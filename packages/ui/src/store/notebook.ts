// The notebook store: the mirror of one notebook (mirror.ts), kept by sync.ts; the getters the views
// read; the connection state the top bar shows; and the command actions of notebookActions.ts.
import type { CellId, Execution } from "@jsnb/core";
import type { ConnectionStatus } from "@jsnb/client";
import { defineStore } from "pinia";
import type { ShallowRef } from "vue";
import { computed, shallowRef, watch } from "vue";

import { attempter, usePageReport } from "./attempt.js";
import type { Mirror } from "./mirror.js";
import { emptyMirror } from "./mirror.js";
import { followed } from "./follow.js";
import { markedOf, neighbourOf } from "./marked.js";
import { allMissing } from "./missing.js";
import { notebookActions } from "./notebookActions.js";
import { sectionsOf, visibleCells } from "./sections.js";
import { useSettingsStore } from "./settings.js";
import { useSessionStore } from "./socket.js";
import { useUiStore } from "./ui.js";

/** The socket's status, with a refused realm.attach (REALM_ATTACHED, 1011) read as a view-only tab. */
export type Connection = ConnectionStatus | "viewOnly";

/** How this tab's realm.attach went: not settled yet, attached, refused as a second tab, or refused otherwise (the
 * error's message). A page without a realm (the output tab) stays `pending`. */
export type PageAttach =
  | { readonly state: "pending" | "attached" }
  /** `takenOver`: this tab held the notebook until another tab took it over. */
  | { readonly state: "viewOnly"; readonly takenOver?: boolean }
  | { readonly state: "failed"; readonly message: string };

/** Derived state, never stored (rules). */
/** The page's selection as the getters read it: the ui store (store/ui.ts). */
type Selected = { readonly selected: CellId | null; readonly anchor: CellId | null };

function getters(mirror: ShallowRef<Mirror>, selection: Selected) {
  const cells = computed(() => mirror.value.notebook?.cells ?? []);
  const byId = computed(() => new Map(cells.value.map((cell) => [cell.id, cell])));
  const sections = computed(() => sectionsOf(cells.value));
  return {
    cellsInOrder: cells,
    byId,
    /** The headings' sections and the cells collapsed ones hide (store/sections.ts). */
    sections,
    /** The cells the page shows, in order: those no collapsed heading hides. */
    visibleInOrder: computed(() => visibleCells(cells.value, sections.value)),
    selectedCell: computed(() => {
      const id = selection.selected;
      return id === null ? undefined : byId.value.get(id);
    }),
    /** The cells the selection marks, in order (store/marked.ts): the selected one alone without a range. */
    markedCells: computed(() => markedOf(cells.value, selection.selected, selection.anchor)),
    runningCell: computed(() => mirror.value.notebook?.kernel.executing ?? null),
    staleCount: computed(() => cells.value.filter((cell) => cell.stale).length),
    /** The cells with an agent edit no one reviewed yet (03-api §5 `EditInfo.review`). */
    agentEditCount: computed(
      () => cells.value.filter((cell) => cell.meta.lastEdit?.review !== undefined).length,
    ),
    errors: computed(() => cells.value.filter((cell) => cell.status === "error")),
    /** The language service's diagnostics over the cells there are (Problems' count). */
    diagnosticCount: computed(() =>
      cells.value.reduce(
        (sum, cell) => sum + (mirror.value.diagnostics.get(cell.id)?.length ?? 0),
        0,
      ),
    ),
    /** The packages the cells' last runs found missing (MissingPackage), each once. */
    missingPackages: computed(() =>
      allMissing(cells.value.map((cell) => mirror.value.executions.get(cell.id)?.error)),
    ),
    lastExecutionOf: (cell: CellId): Execution | undefined => mirror.value.executions.get(cell),
  };
}

/** Side effect: when the selected cell is deleted (its toolbar, its menu, D D, a cut, an agent), the cell above it is
 * selected, the one below when it was the first, in command mode; cells/useFocusFollow.ts moves the
 * focus to it. */
function followDeletes(mirror: ShallowRef<Mirror>, ui: ReturnType<typeof useUiStore>): void {
  watch(
    () => mirror.value.notebook?.cells.map((cell) => cell.id) ?? [],
    (now, before) => {
      const selected = ui.selected;
      if (selected === null || now.includes(selected) || !before.includes(selected)) return;
      ui.setMode("command");
      ui.follow(neighbourOf(before, new Set(now), selected));
    },
  );
}

/** What the store passes on from sync.ts: events in, and the refreshes the views ask for. */
const syncActions = (sync: ReturnType<typeof followed>["sync"]) => ({
  apply: sync.apply,
  refreshRoutes: sync.refreshRoutes,
  refreshDiagnostics: sync.refreshDiagnostics,
  dropDiagnostics: sync.dropDiagnostics,
});

/** How a view-only tab takes the live page over: realm/mount.ts hands the way in, the banner calls it. */
function takeOverActions(attach: ShallowRef<PageAttach>) {
  let how: (() => Promise<unknown>) | null = null;
  return {
    setTakeOver: (given: () => Promise<unknown>) => {
      how = given;
    },
    /** The other tab turns view-only. */
    takeOver: async () => {
      if (attach.value.state === "viewOnly") await how?.();
    },
  };
}

/** What the sync asks of the page: whether to ask for diagnostics, and how to show the daemon's notices. */
const pageHooks = (
  settings: ReturnType<typeof useSettingsStore>,
  ui: ReturnType<typeof useUiStore>,
) => ({
  diagnostics: () => settings.valueOf("editor.diagnostics") !== false,
  notice: (text: string) => {
    ui.toast({ kind: "error", title: text });
  },
});

export const useNotebookStore = defineStore("notebook", () => {
  const session = useSessionStore();
  const settings = useSettingsStore();
  const ui = useUiStore();
  const report = usePageReport();
  const mirror = shallowRef<Mirror>(emptyMirror);
  const attach = shallowRef<PageAttach>({ state: "pending" });
  const context = {
    client: () => session.session().client,
    notebook: () => session.session().notebook,
    attempt: attempter(report),
    report,
  };
  const { sync, hydrate, reopened, close } = followed(mirror, {
    ...context,
    session: () => session.session(),
    ...pageHooks(settings, ui),
  });

  followDeletes(mirror, ui);

  return {
    mirror,
    connection: computed<Connection>(() =>
      session.status === "live" && attach.value.state === "viewOnly" ? "viewOnly" : session.status,
    ),
    hydrate,
    ...syncActions(sync),
    attach,
    reopened,
    /** The error that stopped the page's start, or null (the session's failure, for the views). */
    startFailure: computed(() => session.failure),
    /** The notebook the page asked for, from the start's first moment (a failed start's banner names it). */
    pageName: computed(() => session.notebook),
    /** A session is running: what writes a setting or calls the daemon has a socket to go through. */
    started: computed(() => session.current !== null),
    /** realm/mount.ts reports each attach's outcome here. */
    setAttach: (outcome: PageAttach) => {
      attach.value = outcome;
    },
    ...takeOverActions(attach),
    close,
    ...getters(mirror, ui),
    ...notebookActions(context),
  };
});
