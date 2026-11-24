// The Home page's list and overlay commands: refresh, the row selection Up Down, a folder picked,
// the Explorer's folders folded, the Explorer shown and hidden, a notebook's path copied, the palette and Escape, which
// closes the palette or a dialog, else stops a rename, else clears the search.
import { copyText } from "../store/clipboard.js";
import { useFeedbackStore } from "../store/feedback.js";
import { stepFrom } from "../store/homeRows.js";
import { shownOrder } from "../store/homeView.js";
import type { useHomeStore } from "../store/home.js";
import type { useUiStore } from "../store/ui.js";
import type { Command } from "./command.js";
import { stringArg, uiCommand as ui } from "./command.js";

type Home = ReturnType<typeof useHomeStore>;
type Ui = ReturnType<typeof useUiStore>;

/** Refresh, the selection, a folder folded or picked, and the two panels. */
function rowCommands(home: Home): readonly Command[] {
  const step = (by: 1 | -1) => {
    home.selected = stepFrom(shownOrder(home), home.selected, by);
  };
  return [
    ui("ui.home.refresh", "Refresh the notebook list", () => home.refresh()),
    ui("ui.home.select.next", "Select the next notebook", () => {
      step(1);
    }),
    ui("ui.home.select.previous", "Select the previous notebook", () => {
      step(-1);
    }),
    ui("ui.home.folder", "Show the notebooks of a folder", (args) => {
      home.folder = stringArg(args, "folder") ?? "";
    }),
    ui("ui.home.side.toggle", "Show or hide the side panel", () => {
      home.togglePanel("side");
    }),
    ui("ui.home.view.toggle", "Show or hide a view", (args) => {
      home.toggleView(stringArg(args, "view") === "sourceControl" ? "sourceControl" : "explorer");
    }),
    ui("ui.home.view.open", "Open a view", (args) => {
      home.openView(stringArg(args, "view") === "sourceControl" ? "sourceControl" : "explorer");
    }),
    ui("ui.home.collapseAll", "Collapse folders in the Explorer", () => {
      home.expanded = [];
    }),
  ];
}

/** The palette, and Escape: it closes the palette or a dialog, else stops a rename, else clears the search. */
function overlayCommands(home: Home, store: Ui): readonly Command[] {
  const feedback = useFeedbackStore();
  return [
    ui("ui.palette.open", "Open the command palette", () => {
      store.overlay = null;
      store.openPalette();
    }),
    ui("ui.palette.close", "Close the command palette", () => {
      store.closePalette();
    }),
    ui("ui.overlay.close", "Close the open dialog", () => {
      store.overlay = null;
    }),
    ui("ui.escape", "Close the top overlay, else stop renaming, else clear the search", () => {
      if (feedback.closeNote()) return;
      if (store.palette.open) store.closePalette();
      else if (store.overlay !== null) store.overlay = null;
      else if (feedback.stop()) return;
      else if (home.renaming !== null) {
        // the focus goes back to the search field, never to the page; a rename in the tree gives it back to the
        // tree's row (HomeSide)
        home.renaming = null;
        if (home.renameIn === "list") home.searchFocus += 1;
      } else {
        home.query = "";
        home.naming = false;
      }
    }),
  ];
}

/** Copy Path: the notebook's or folder's full path on disk. */
const copyPath = (home: Home, store: Ui): Command =>
  ui(
    "ui.home.copyPath",
    "Copy Path",
    (args) => {
      const path = stringArg(args, "path");
      const root = home.daemon?.root ?? "";
      if (path !== undefined)
        void copyText(store, root === "" ? path : `${root}/${path}`, "the path");
    },
    (args) => stringArg(args, "path") !== undefined,
  );

export const listCommands = (home: Home, store: Ui): readonly Command[] => [
  ...rowCommands(home),
  copyPath(home, store),
  ...overlayCommands(home, store),
];
