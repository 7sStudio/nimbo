// What both pages' dispatchers share: the theme (toggled, or set from the View menu and the gear), the Keyboard
// Shortcuts editor, the Settings editor, and the feedback mode with its list.
import { syntaxThemes } from "@jsnb/tokens";

import { useFeedbackStore } from "../store/feedback.js";
import { useGitStore } from "../store/git.js";
import { useSettingsStore } from "../store/settings.js";
import { useSessionStore } from "../store/socket.js";
import { useUiStore } from "../store/ui.js";
import type { Args, Command } from "./command.js";
import { gitCommands } from "./git.js";
import { gitBranchCommands } from "./gitBranch.js";
import { gitRemoteCommands } from "./gitRemote.js";
import { stringArg, uiCommand as ui } from "./command.js";

/** The theme after a toggle: the opposite of what shows now, `system` resolved through `prefersDark`. */
export function nextTheme(current: unknown, prefersDark: boolean): "light" | "dark" {
  const showing =
    current === "light" || current === "dark" ? current : prefersDark ? "dark" : "light";
  return showing === "dark" ? "light" : "dark";
}

/** The scope the toggle writes: the one that decides the theme now, so a workspace's own ui.theme (which outranks the
 * user's) changes too instead of the toggle doing nothing; the user's scope otherwise. */
const themeScope = (source: string | undefined): "user" | "workspace" =>
  source === "workspace" ? "workspace" : "user";

const prefersDark = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

/** The theme toggle, the notebook page's and Home's alike: it writes the setting ui.theme. */
function themeToggle(): Command {
  const settings = useSettingsStore();
  const session = useSessionStore();
  return ui(
    "ui.theme.toggle",
    "Toggle light and dark",
    () =>
      settings.set(
        "ui.theme",
        nextTheme(settings.valueOf("ui.theme"), prefersDark()),
        themeScope(settings.values["ui.theme"]?.source),
      ),
    // the theme is the setting ui.theme: with no session (a page whose start stopped) there is nothing to write it to
    () => session.current !== null,
  );
}

const themes = ["system", "light", "dark"] as const;

/** Feedback mode: a pointer that picks an element to write a note on, kept for a later reader, and the
 * list of the notes kept. */
function feedbackCommands(store: ReturnType<typeof useUiStore>): readonly Command[] {
  const feedback = useFeedbackStore();
  return [
    ui("ui.feedback.toggle", "Toggle Feedback Mode", () => {
      store.closePalette();
      feedback.toggle();
    }),
    ui("ui.feedback.list", "Show Feedback", () => {
      store.closePalette();
      feedback.note = null;
      store.overlay = { kind: "feedback" };
    }),
  ];
}

/** The code colours by name (File > Preferences > Syntax Theme), written as the theme is: in the user's settings, or
 * the workspace's while it decides them, as VS Code's Color Theme picker writes. */
function syntaxThemeSet(): Command {
  const settings = useSettingsStore();
  const session = useSessionStore();
  return ui(
    "ui.syntaxTheme.set",
    "Set the syntax theme",
    (args) => {
      const theme = stringArg(args, "theme");
      if (theme === undefined || !(theme in syntaxThemes)) return undefined;
      const source = settings.values["editor.syntaxTheme"]?.source;
      return settings.set("editor.syntaxTheme", theme, themeScope(source));
    },
    (args) =>
      session.current !== null && typeof args?.theme === "string" && args.theme in syntaxThemes,
  );
}

/** Settings (JSON) holds unsaved text: asks Save / Don't Save / Cancel before `command` closes Settings or leaves the
 * page, and says so; the dialog's answer runs `command` again (overlays/SettingsLeaveDialog.vue). */
export function askSettingsFirst(
  store: ReturnType<typeof useUiStore>,
  command: string,
  args?: Readonly<Record<string, unknown>>,
): boolean {
  if (store.settingsUnsavedScopes().length === 0) return false;
  store.closePalette();
  store.overlay = { kind: "confirmSettings", command, ...(args === undefined ? {} : { args }) };
  return true;
}

/** Shows an editor in the main area of either page, its list view first (Cmd , and Cmd K Cmd S, as VS Code's). */
function openPage(store: ReturnType<typeof useUiStore>, page: "settings" | "keybindings"): void {
  store.closePalette();
  store.overlay = null;
  store.page = page;
  store.pageJson = false;
}

/** The theme toggle, the theme set by name, the Keyboard Shortcuts and Settings editors. */
export function appCommands(): readonly Command[] {
  const settings = useSettingsStore();
  const session = useSessionStore();
  const store = useUiStore();
  return [
    themeToggle(),
    ui(
      "ui.theme.set",
      "Set the theme",
      (args) => {
        const theme = themes.find((each) => each === stringArg(args, "theme"));
        if (theme === undefined) return undefined;
        return settings.set("ui.theme", theme, themeScope(settings.values["ui.theme"]?.source));
      },
      (args) => session.current !== null && themes.some((each) => each === args?.theme),
    ),
    syntaxThemeSet(),
    // Keyboard Shortcuts and Settings are editors of their own in the main area, as VS Code's
    ui("ui.shortcuts.open", "Keyboard Shortcuts", () => {
      openPage(store, "keybindings");
    }),
    ui("ui.settings.open", "Settings", () => {
      openPage(store, "settings");
    }),
    ui(
      "ui.page.close",
      "Close Editor",
      () => {
        if (askSettingsFirst(store, "ui.page.close")) return;
        store.page = null;
      },
      () => store.page !== null,
    ),
    ...feedbackCommands(store),
    ...diffCommands(store),
    ...gitCommands(),
    ...gitRemoteCommands(),
    ...gitBranchCommands(),
  ];
}

/** The diff page of `path`: the working tree's (the index's with staged), a commit's, a commit's against the working
 * tree (base), or an open notebook's file on disk against the page (disk). */
function openDiff(store: ReturnType<typeof useUiStore>, args: Args | undefined): void {
  const path = stringArg(args, "path");
  if (path === undefined) return;
  store.closePalette();
  store.overlay = null;
  if (args?.disk === true) {
    store.diff = { path, staged: false, disk: true };
    store.page = "diff";
    return;
  }
  const commit = stringArg(args, "commit");
  const base = stringArg(args, "base");
  store.diff = {
    path,
    staged: args?.staged === true,
    ...(commit === undefined ? {} : { commit }),
    ...(base === undefined ? {} : { base }),
  };
  store.page = "diff";
}

/** The diff editor: a changed file's diff in the main area, as VS Code opens one in an
 * editor tab, and the keys that step from change to change in it (Alt F5, Shift Alt F5). */
function diffCommands(store: ReturnType<typeof useUiStore>): readonly Command[] {
  const git = useGitStore();
  return [
    ui(
      "ui.diff.open",
      "Open Changes",
      (args) => {
        openDiff(store, args);
      },
      (args) => typeof args?.path === "string",
    ),
    ui(
      "ui.diff.next",
      "Next Change",
      () => {
        store.diffStep = { by: 1, at: (store.diffStep?.at ?? 0) + 1 };
      },
      () => store.page === "diff",
    ),
    ui(
      "ui.diff.previous",
      "Previous Change",
      () => {
        store.diffStep = { by: -1, at: (store.diffStep?.at ?? 0) + 1 };
      },
      () => store.page === "diff",
    ),
    ui(
      "ui.git.refresh",
      "Refresh Source Control",
      () => git.refresh(),
      () => git.repo !== null,
    ),
  ];
}
