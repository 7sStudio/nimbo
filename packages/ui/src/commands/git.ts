// The Source Control view's commands, on both pages: stage, unstage and discard whole files,
// commit the message box, open a changed file. Discard asks first, as VS Code does, and a commit with nothing staged
// asks whether to stage everything (VS Code's smart commit); each is sent again, answered, from its dialog.
import { notebookPageUrl } from "../store/address.js";
import { placeOf } from "../store/layout.js";
import { useGitStore } from "../store/git.js";
import { useHistoryStore } from "../store/history.js";
import { useUiStore } from "../store/ui.js";
import type { Args, Command } from "./command.js";
import { stringArg, uiCommand as ui } from "./command.js";
import { gitWrite } from "./gitCall.js";
import { consented } from "./consent.js";

/** The `paths` argument: a list of strings, or `path` alone. */
function pathsArg(args: Args | undefined): readonly string[] {
  const list = args?.paths;
  if (Array.isArray(list)) return list.filter((each): each is string => typeof each === "string");
  const one = stringArg(args, "path");
  return one === undefined ? [] : [one];
}

const hasPaths = (args?: Args) => pathsArg(args).length > 0;

/** The notebook page of `path`, at `cell` when given: this tab's own notebook shows again with the cell selected;
 * another notebook opens in this tab. */
function openFile(
  path: string,
  cell: string | undefined,
  store: ReturnType<typeof useUiStore>,
): void {
  const here = decodeURIComponent(location.pathname.replace(/^\/ui\//u, ""));
  if (here !== path) {
    location.assign(
      `${notebookPageUrl(path, location)}${cell === undefined ? "" : `#cell=${encodeURIComponent(cell)}`}`,
    );
    return;
  }
  store.page = null;
  if (cell !== undefined) store.select(cell);
}

/** The Source Control view, where the history shows. */
function showView(store: ReturnType<typeof useUiStore>): void {
  const place = placeOf("sourceControl");
  if (place !== undefined) store.openPlace(place);
}

const confirmed = (args?: Args) => consented(args);

/** Commit: with nothing staged it asks first whether to stage everything, VS Code's smart commit. */
function commitCommand(
  git: ReturnType<typeof useGitStore>,
  store: ReturnType<typeof useUiStore>,
): Command {
  return gitWrite(
    "ui.git.commit",
    "Commit",
    (args) => {
      const repo = git.repo;
      if (repo === null || git.message.trim() === "") return undefined;
      const nothingStaged = repo.staged.length === 0;
      if (nothingStaged && args?.all !== true && !confirmed(args)) {
        store.overlay = { kind: "confirmGit", action: "commitAll", paths: [] };
        return undefined;
      }
      return git.commit(nothingStaged || args?.all === true);
    },
    () => git.repo !== null && git.message.trim() !== "",
  );
}

/** View History and Open File History: the History section of the Source Control view. */
function historyCommands(
  git: ReturnType<typeof useGitStore>,
  store: ReturnType<typeof useUiStore>,
): readonly Command[] {
  return [
    ui(
      "ui.git.history",
      "View History",
      () => {
        showView(store);
        return useHistoryStore().show(null);
      },
      () => git.repo !== null,
    ),
    ui(
      "ui.git.fileHistory",
      "Open File History",
      (args) => {
        const path = stringArg(args, "path");
        if (path === undefined) return undefined;
        showView(store);
        return useHistoryStore().show(path);
      },
      (args) => git.repo !== null && stringArg(args, "path") !== undefined,
    ),
  ];
}

export function gitCommands(): readonly Command[] {
  const git = useGitStore();
  const store = useUiStore();
  return [
    gitWrite("ui.git.stage", "Stage Changes", (args) => git.stage(pathsArg(args)), hasPaths),
    gitWrite("ui.git.unstage", "Unstage Changes", (args) => git.unstage(pathsArg(args)), hasPaths),
    gitWrite(
      "ui.git.discard",
      "Discard Changes",
      (args) => {
        const paths = pathsArg(args);
        if (confirmed(args)) return git.discard(paths);
        store.overlay = { kind: "confirmGit", action: "discard", paths };
        return undefined;
      },
      hasPaths,
    ),
    commitCommand(git, store),
    ...historyCommands(git, store),
    ui(
      "ui.git.openFile",
      "Open File",
      (args) => {
        const path = stringArg(args, "path");
        if (path?.endsWith(".jsnb") === true) openFile(path, stringArg(args, "cell"), store);
      },
      (args) => stringArg(args, "path")?.endsWith(".jsnb") === true,
    ),
  ];
}
