// The Source Control view's commands, on both pages: stage, unstage and discard whole files,
// commit the message box, open a changed file. Discard asks first, as VS Code does, and a commit with nothing staged
// asks whether to stage everything (VS Code's smart commit); each is sent again, answered, from its dialog.
import { notebookPageUrl } from "../store/address.js";
import { useGitStore } from "../store/git.js";
import { useUiStore } from "../store/ui.js";
import type { Args, Command } from "./command.js";
import { stringArg, uiCommand as ui } from "./command.js";

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

const confirmed = (args?: Args) => args?.confirmed === true;

/** Commit: with nothing staged it asks first whether to stage everything, VS Code's smart commit. */
function commitCommand(
  git: ReturnType<typeof useGitStore>,
  store: ReturnType<typeof useUiStore>,
): Command {
  return ui(
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

export function gitCommands(): readonly Command[] {
  const git = useGitStore();
  const store = useUiStore();
  return [
    ui("ui.git.stage", "Stage Changes", (args) => git.stage(pathsArg(args)), hasPaths),
    ui("ui.git.unstage", "Unstage Changes", (args) => git.unstage(pathsArg(args)), hasPaths),
    ui(
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
