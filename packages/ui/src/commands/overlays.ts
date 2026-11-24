// The overlay commands: the palette, the cell menu, the type menu, the restart menu; the kernel log is the bottom panel's tab, opened here by its older command;
// Escape closes the top one. Each only changes what the page shows: what a menu item does is its own command.
import { useFeedbackStore } from "../store/feedback.js";
import { useSessionStore } from "../store/socket.js";
import type { Anchor, Overlay, RestartFrom } from "../store/overlay.js";
import { useUiStore } from "../store/ui.js";
import type { Args, Command } from "./command.js";
import { stringArg, uiCommand as ui } from "./command.js";

type Ui = ReturnType<typeof useUiStore>;

/** The point a right-click gave, when both coordinates are numbers. */
function pointOf(args: Args | undefined): Anchor | null {
  const x = args?.x;
  const y = args?.y;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

/** The cell named by `cell` or the selected one; selecting it, so the menu's items act on it. */
function cellFor(store: Ui, args: Args | undefined): string | null {
  const cell = stringArg(args, "cell") ?? store.selected;
  if (cell !== null && cell !== store.selected) store.select(cell);
  return cell;
}

/** Opens `overlay`, the only one open: the palette closes first; opening the one already open closes it, so its control
 * toggles it as a second click does. */
function show(store: Ui, overlay: Overlay): void {
  store.closePalette();
  store.overlay = JSON.stringify(store.overlay) === JSON.stringify(overlay) ? null : overlay;
}

const hasCell = (store: Ui) => (args?: Args) =>
  stringArg(args, "cell") !== undefined || store.selected !== null;

function menuCommands(store: Ui): readonly Command[] {
  return [
    ui(
      "ui.cellMenu.open",
      "Open the cell's menu",
      (args) => {
        const cell = cellFor(store, args);
        if (cell !== null) show(store, { kind: "cellMenu", cell, at: pointOf(args) });
      },
      hasCell(store),
    ),
    ui(
      "ui.typeMenu.open",
      "Change the cell's type…",
      (args) => {
        const cell = cellFor(store, args);
        if (cell !== null) show(store, { kind: "typeMenu", cell });
      },
      hasCell(store),
    ),
    ui("ui.restartMenu.open", "Open the restart menu", (args) => {
      const from: RestartFrom = stringArg(args, "from") === "cluster" ? "cluster" : "button";
      show(store, { kind: "restartMenu", from });
    }),
  ];
}

export function overlayCommands(): readonly Command[] {
  const store = useUiStore();
  const session = useSessionStore();
  const feedback = useFeedbackStore();
  return [
    ui("ui.palette.open", "Open the command palette", () => {
      store.overlay = null;
      store.openPalette();
    }),
    ui("ui.palette.close", "Close the command palette", () => {
      store.closePalette();
    }),
    ui(
      "ui.escape",
      "Close the feedback note or the top overlay, else leave feedback mode or the editor",
      () => {
        if (feedback.closeNote()) return;
        if (store.palette.open) store.closePalette();
        else if (store.overlay !== null) store.overlay = null;
        else if (feedback.stop()) return;
        else if (store.fullscreen !== null) store.fullscreen = null;
        else store.setMode("command");
      },
    ),
    ui("ui.overlay.close", "Close the open menu or dialog", () => {
      store.overlay = null;
    }),
    ...menuCommands(store),
    ui(
      "ui.kernelLog.open",
      "Show the kernel log",
      () => {
        store.openPlace({ region: "bottom", tab: "kernelLog" });
      },
      () => session.current !== null,
    ),
  ];
}
