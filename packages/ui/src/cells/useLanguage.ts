// The page's side of the language service, for the notebook CellList shows: the host the
// editors' LSP client talks through, the settings it follows, and the socket's comebacks. The client and the library
// stay in their lazy chunk (editor/language/client.ts); this file only wires the page to editor/language/host.ts.
import type { EditorView } from "@codemirror/view";
import { nextTick, onBeforeUnmount, watch } from "vue";

import type { Dispatcher } from "../commands/dispatch.js";
import type { LanguageHost } from "../editor/language/host.js";
import {
  reconnectLanguage,
  refreshLanguage,
  setLanguageHost,
  viewOf,
} from "../editor/language/host.js";
import type { useNotebookStore } from "../store/notebook.js";
import type { useSettingsStore } from "../store/settings.js";
import type { useUiStore } from "../store/ui.js";

type Stores = {
  readonly store: ReturnType<typeof useNotebookStore>;
  readonly ui: ReturnType<typeof useUiStore>;
  readonly settings: ReturnType<typeof useSettingsStore>;
  readonly dispatcher: Dispatcher;
  /** Writes are off on this page (a view-only tab, a closed notebook). */
  readonly off: () => boolean;
};

/** The editor of `cell` once it is mounted (an unfolded cell mounts on the next ticks), or null after a few. */
async function mountedView(cell: string): Promise<EditorView | null> {
  for (let tick = 0; tick < 10; tick += 1) {
    const view = viewOf(cell);
    if (view) return view;
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return null;
}

/** The page's side the editors' client talks through. */
function hostOf({ store, ui, settings, dispatcher, off }: Stores): LanguageHost {
  return {
    notebook: () => store.mirror.notebook?.path ?? "",
    lsp: (message) => store.lsp(message),
    intellisense: () => settings.valueOf("editor.intellisense") !== false,
    readOnly: off,
    openCell: async (cell) => {
      await dispatcher.dispatch("ui.select", { cell });
      if (store.byId.get(cell)?.meta.collapsed === true && !off())
        await dispatcher.dispatch("ui.cell.toggleCollapse");
      else if (ui.foldAll) ui.setOpened(cell, true);
      await dispatcher.dispatch("ui.mode.edit");
      return mountedView(cell);
    },
    showFile: (path, line) => {
      ui.toast({
        kind: "info",
        title: "Defined outside the notebook",
        text: `${path}:${String(line + 1)}`,
      });
    },
    expand: (title, html) => {
      ui.overlay = { kind: "hint", title, html };
    },
    rename: async (cell, at, newName) => {
      await ui.flushDrafts.run();
      return store.rename(cell, at, newName);
    },
  };
}

export function useLanguage(stores: Stores): void {
  const { store, settings } = stores;
  const host = hostOf(stores);
  setLanguageHost(host);
  watch(host.intellisense, () => {
    refreshLanguage();
  });
  // Side effect: editor.diagnostics on asks for the lists, off drops them; also at mount, since the setting may have
  // changed while the cells were not shown (Settings covers them and unmounts this list)
  const diagnosticsOn = () => settings.valueOf("editor.diagnostics") !== false;
  if (!diagnosticsOn()) store.dropDiagnostics();
  else if (store.mirror.diagnostics.size === 0) void store.refreshDiagnostics();
  watch(diagnosticsOn, (on) => {
    if (on) void store.refreshDiagnostics();
    else store.dropDiagnostics();
  });
  watch(
    () => store.connection,
    (now, before) => {
      if (now === "live" && before !== "live" && before !== "viewOnly") reconnectLanguage();
    },
  );
  onBeforeUnmount(() => {
    setLanguageHost(null);
  });
}
