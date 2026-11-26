// Home's Tutorial and Examples commands: ui.home.example copies the shipped notebook `name` (an example, or one lesson)
// into the workspace folder (examples.copy; a name taken gets the next free number), opens the copy and lands on its
// page; ui.home.tutorial opens the workspace's copy of the lesson `name`, else the one the tutorial goes on with,
// copying every lesson into tutorial/ first when none is there yet, or only that lesson when its copy is gone, so
// starting twice goes on rather than copying again. ui.home.tutorial.show shows the Tutorial in the main area, the
// tutorial put back on Home when it was hidden; ui.home.tutorial.hide takes it off Home (the setting
// tutorial.showOnHome). The shipped files are never opened where they ship.
import { nextLesson } from "../store/lessons.js";
import { notebookPageUrl } from "../store/address.js";
import type { useHomeStore } from "../store/home.js";
import { useSettingsStore } from "../store/settings.js";
import { useSessionStore } from "../store/socket.js";
import { useUiStore } from "../store/ui.js";
import type { Command } from "./command.js";
import { stringArg, uiCommand as ui } from "./command.js";
import type { HomeHost } from "./homeHost.js";

type Home = ReturnType<typeof useHomeStore>;

const showOnHome = "tutorial.showOnHome";

async function land(home: Home, host: HomeHost, path: string | undefined) {
  if (path === undefined || (await home.open(path)) === undefined) return undefined;
  host.navigate(notebookPageUrl(path, { search: host.search() }));
  return path;
}

export const openExample = (home: Home, host: HomeHost): Command => ({
  ...ui(
    "ui.home.example",
    "Open a copy of an example",
    async (args) => {
      const name = stringArg(args, "name");
      if (name === undefined) return undefined;
      return land(home, host, await home.copyExample(name));
    },
    (args) => stringArg(args, "name") !== undefined,
  ),
  writes: true,
});

/** The copy of the lesson `name` there is, made when missing: every lesson while none has a copy, else that one. */
async function lessonCopy(home: Home, name: string): Promise<string | undefined> {
  const has = (lesson: string) => home.notebooks.some((each) => each.path === `${lesson}.jsnb`);
  if (has(name)) return `${name}.jsnb`;
  if (!home.lessons.some((each) => has(each.name))) {
    const first = await home.copyTutorial();
    return first === undefined ? undefined : `${name}.jsnb`;
  }
  return home.copyExample(name);
}

export const startTutorial = (home: Home, host: HomeHost): Command => ({
  ...ui(
    "ui.home.tutorial",
    "Start the tutorial, or go on with it",
    async (args) => {
      const name = stringArg(args, "name") ?? (nextLesson(home.lessons) ?? home.lessons[0])?.name;
      if (name === undefined || !home.lessons.some((each) => each.name === name)) return undefined;
      return land(home, host, await lessonCopy(home, name));
    },
    () => home.lessons.length > 0,
  ),
  writes: true,
});

/** The Tutorial in the main area and its place on Home: shown (put back on Home when it was hidden) and hidden. */
export function tutorialPlace(home: Home): readonly Command[] {
  const store = useUiStore();
  const settings = useSettingsStore();
  const session = useSessionStore();
  const live = () => session.current !== null;
  const shownOnHome = () => settings.valueOf(showOnHome) !== false;
  return [
    ui(
      "ui.home.tutorial.show",
      "Show the tutorial",
      async (args) => {
        store.closePalette();
        store.overlay = null;
        if (args?.page !== false) store.page = "learn";
        const entry = settings.values[showOnHome];
        for (const scope of ["user", "workspace"] as const)
          if (entry?.[scope] === false) await settings.reset(showOnHome, scope);
      },
      () => home.lessons.length > 0,
    ),
    ui(
      "ui.home.tutorial.hide",
      "Hide the tutorial from Home",
      async () => {
        const scope = settings.values[showOnHome]?.source === "workspace" ? "workspace" : "user";
        if (store.page === "learn") store.page = null;
        if ((await settings.set(showOnHome, false, scope)) === undefined) return;
        store.toast({
          kind: "info",
          title: "Tutorial hidden",
          text: "Help > Tutorial shows it again.",
          action: { label: "Undo", command: "ui.home.tutorial.show", args: { page: false } },
        });
      },
      () => live() && shownOnHome(),
    ),
  ];
}
