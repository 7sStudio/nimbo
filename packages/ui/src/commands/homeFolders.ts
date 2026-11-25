// Home's Open folder command: without a path it opens the picker; with one it makes that folder the
// workspace (workspace.open finds or starts the folder's own daemon and this one stops) and the page moves to the
// other daemon's Home. While notebooks of this folder are open it asks first, in the picker, unless a dialog consented (consent.ts); an
// open that fails answers its words (the picker shows them) and is a toast from the palette.
import type { useHomeStore } from "../store/home.js";
import type { useUiStore } from "../store/ui.js";
import type { Command } from "./command.js";
import { stringArg, uiCommand as ui } from "./command.js";
import { consented } from "./consent.js";
import type { HomeHost } from "./homeHost.js";

type Home = ReturnType<typeof useHomeStore>;
type Ui = ReturnType<typeof useUiStore>;

/** "2 notebooks are open and 1 kernel is running here. Opening another folder closes them.", or null when nothing is
 * open here. */
export function leavingWords(home: Home): string | null {
  const open = home.notebooks.filter((each) => each.open).length;
  if (open === 0) return null;
  const busy = Object.values(home.kernels).filter((kernel) => kernel.state === "busy").length;
  const notebooks = open === 1 ? "1 notebook is open" : `${String(open)} notebooks are open`;
  const kernels =
    busy === 0 ? "" : ` and ${busy === 1 ? "1 kernel is" : `${String(busy)} kernels are`} running`;
  const them =
    open === 1 && busy === 0 ? "it and stops its kernel" : "them and stops their kernels";
  return `${notebooks}${kernels} here. Opening another folder closes ${them}.`;
}

export const openFolder = (home: Home, store: Ui, host: HomeHost): Command => ({
  ...ui("ui.home.openFolder", "Open a folder…", async (args) => {
    const path = stringArg(args, "path");
    if (path === undefined) {
      store.overlay = { kind: "folderPicker" };
      return undefined;
    }
    if (leavingWords(home) !== null && !consented(args)) {
      store.overlay = { kind: "folderPicker", path, confirm: true };
      return undefined;
    }
    const answer = await home.openFolder(path);
    if ("url" in answer) host.navigate(answer.url);
    else if (args?.fromPicker !== true)
      store.toast({ kind: "error", title: "Could not open the folder", text: answer.error });
    return answer;
  }),
  writes: true,
});
