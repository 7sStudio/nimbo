// Home's Tutorial and Examples commands: ui.home.example copies the shipped notebook `name` (an example, or one lesson)
// into the workspace folder (examples.copy; a name taken gets the next free number), opens the copy and lands on its
// page; ui.home.tutorial opens the workspace's copy of the first lesson, or copies every lesson into tutorial/ first
// when there is none, so starting the tutorial twice resumes it rather than copying it again. The shipped files are
// never opened where they ship.
import { notebookPageUrl } from "../store/address.js";
import type { useHomeStore } from "../store/home.js";
import type { Command } from "./command.js";
import { stringArg, uiCommand as ui } from "./command.js";
import type { HomeHost } from "./homeHost.js";

type Home = ReturnType<typeof useHomeStore>;

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

export const startTutorial = (home: Home, host: HomeHost): Command => ({
  ...ui(
    "ui.home.tutorial",
    "Start the tutorial",
    async () => {
      const first = home.lessons[0];
      if (first === undefined) return undefined;
      const copied = home.notebooks.some((each) => each.path === `${first.name}.jsnb`);
      return land(home, host, copied ? `${first.name}.jsnb` : await home.copyTutorial());
    },
    () => home.lessons.length > 0,
  ),
  writes: true,
});
