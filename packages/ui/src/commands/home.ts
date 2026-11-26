// The Home page's commands: create, open, close, rename and delete a notebook, refresh the list,
// move the row selection, fold a folder, with the palette, Escape and the theme toggle the notebook page has too. A
// command names its notebook with `path`, or acts on the selected row. Delete always asks, and so does closing a busy
// kernel (store/overlay.ts `confirmNotebook`); an open notebook is closed before it is deleted, and renamed as it
// is, its kernel running on. Opening and creating land on the notebook's page.
import { useHomeStore } from "../store/home.js";
import { notebookPageUrl } from "../store/address.js";
import { useUiStore } from "../store/ui.js";
import { newPath } from "../store/homeRows.js";
import { shownOrder } from "../store/homeView.js";
import type { Args, Command } from "./command.js";
import { stringArg, uiCommand as ui } from "./command.js";
import { consented } from "./consent.js";
import type { HomeHost } from "./homeHost.js";
import { openExample } from "./homeExamples.js";
import { openFolder } from "./homeFolders.js";
import { listCommands } from "./homeList.js";

type Home = ReturnType<typeof useHomeStore>;
type Ui = ReturnType<typeof useUiStore>;

const goTo = (host: HomeHost, path: string) => {
  host.navigate(notebookPageUrl(path, { search: host.search() }));
};

/** A command that sends a write to the daemon: refused while the socket is not live (homeDispatch.ts). */
const writing = (command: Command): Command => ({ ...command, writes: true });

/** The notebook `path` names, else the selected row; null when it is not in the list. */
function pathOf(home: Home, args: Args | undefined): string | null {
  const path = stringArg(args, "path") ?? home.selected;
  return path !== null && home.notebooks.some((each) => each.path === path) ? path : null;
}

/** Runs a create or a rename unless one of the same kind is under way: a second Enter or click while the first is out
 * sends nothing (it would answer "already exists" while the first lands); a create and a rename go side by side. */
async function once<T>(
  home: Home,
  what: "create" | "rename",
  call: () => Promise<T | undefined>,
): Promise<T | undefined> {
  if (home.pending.has(what)) return undefined;
  home.pending = new Set([...home.pending, what]);
  try {
    return await call();
  } finally {
    home.pending = new Set([...home.pending].filter((each) => each !== what));
  }
}

const entryOf = (home: Home, path: string) => home.notebooks.find((each) => each.path === path);
const isBusy = (home: Home, path: string) => home.kernels[path]?.state === "busy";

/** The row after `path` in the shown order (or before it, at the end), for the selection once `path` is gone. */
function neighbour(home: Home, path: string): string | null {
  const order = shownOrder(home);
  const at = order.indexOf(path);
  return order[at + 1] ?? order[at - 1] ?? null;
}

const has = (home: Home) => (args?: Args) => pathOf(home, args) !== null;
const isOpenRow = (home: Home, open: boolean) => (args?: Args) => {
  const path = pathOf(home, args);
  return path !== null && entryOf(home, path)?.open === open;
};

/** ui.notebook.new: with a name, creates the notebook (in `folder`, else the folder the Workspace panel picked) and
 * lands on its page; without one, the search field takes the focus and says that Cmd Enter creates what is typed. */
const newNotebook = (home: Home, host: HomeHost): Command =>
  ui("ui.notebook.new", "New notebook", async (args) => {
    const name = stringArg(args, "name");
    if (name === undefined || name.trim() === "") {
      home.naming = true;
      home.searchFocus += 1;
      return undefined;
    }
    const path = newPath(name, stringArg(args, "folder") ?? home.folder);
    const created = await once(home, "create", () => home.create(path));
    if (created !== undefined) goTo(host, path);
    return created;
  });

/** ui.notebook.open: opens the notebook when it is closed (its kernel starts), then lands on its page. */
const openNotebook = (home: Home, host: HomeHost): Command =>
  ui(
    "ui.notebook.open",
    "Open the notebook",
    async (args) => {
      const path = pathOf(home, args);
      if (path === null) return;
      if (entryOf(home, path)?.open !== true && (await home.open(path)) === undefined) return;
      goTo(host, path);
    },
    has(home),
  );

/** ui.notebook.close: stops the kernel, asking first while it is busy. */
const closeNotebook = (home: Home, store: Ui): Command =>
  ui(
    "ui.notebook.close",
    "Close the notebook (stop its kernel)",
    async (args) => {
      const path = pathOf(home, args);
      if (path === null) return;
      if (isBusy(home, path) && !consented(args)) {
        store.overlay = { kind: "confirmNotebook", action: "close", path };
        return;
      }
      await home.close(path);
    },
    isOpenRow(home, true),
  );

/** ui.notebook.rename: without `to`, the row's inline field (the Explorer's tree, else the list); with it, the
 * rename, an open notebook staying open under the new name. Once it went through, or did nothing, the search
 * field has the focus again (never the page, where Delete asks about a row). */
const renameNotebook = (home: Home): Command =>
  ui(
    "ui.notebook.rename",
    "Rename the notebook",
    async (args) => {
      const path = pathOf(home, args);
      const to = stringArg(args, "to");
      if (path === null) return;
      if (to === undefined) {
        home.renameIn = stringArg(args, "where") === "tree" ? "tree" : "list";
        home.selected = path;
        home.renaming = path;
        return;
      }
      if (to === path || (await once(home, "rename", () => home.rename(path, to))) !== undefined) {
        // a rename into a folded folder unfolds it, so the row that takes the selection and the focus shows
        home.reveal(to);
        home.renaming = null;
        home.selected = to;
        if (home.renameIn === "list") home.searchFocus += 1;
      }
    },
    has(home),
  );

/** ui.notebook.delete: asks first; an open notebook is closed, then its file deleted, but only once the daemon said the
 * open notebook is all that stops the delete (a notebook reached through a linked folder stays open, its refusal a
 * toast); the selection moves on. */
const deleteNotebook = (home: Home, store: Ui): Command =>
  ui(
    "ui.notebook.delete",
    "Delete the notebook…",
    async (args) => {
      const path = pathOf(home, args);
      if (path === null) return;
      if (!consented(args)) {
        store.overlay = { kind: "confirmNotebook", action: "delete", path };
        return;
      }
      // the list may arrive before the answer and move the selection away: the row's neighbour takes it
      const [next, held] = [neighbour(home, path), home.selected === path];
      const first = await home.removeUnlessOpen(path);
      let removed: unknown = first;
      if (first !== undefined && "open" in first) {
        if ((await home.close(first.open)) === undefined) return;
        removed = await home.remove(path);
      }
      if (removed !== undefined && held) home.selected = next;
    },
    has(home),
  );

/** Every command of the Home page but the theme toggle (homeDispatch.ts adds it). */
export function homeCommands(host: HomeHost): readonly Command[] {
  const home = useHomeStore();
  const store = useUiStore();
  const files = [
    newNotebook(home, host),
    openNotebook(home, host),
    closeNotebook(home, store),
    renameNotebook(home),
    deleteNotebook(home, store),
  ];
  return [
    ...files.map(writing),
    openFolder(home, store, host),
    openExample(home, host),
    ...listCommands(home, store),
  ];
}
