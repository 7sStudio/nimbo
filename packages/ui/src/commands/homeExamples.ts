// Home's Examples command: ui.home.example copies the shipped example `name` into the workspace folder
// (examples.copy; a name taken gets the next free number), opens the copy and lands on its page. The shipped file is
// never opened where it ships.
import { notebookPageUrl } from "../store/address.js";
import type { useHomeStore } from "../store/home.js";
import type { Command } from "./command.js";
import { stringArg, uiCommand as ui } from "./command.js";
import type { HomeHost } from "./homeHost.js";

type Home = ReturnType<typeof useHomeStore>;

export const openExample = (home: Home, host: HomeHost): Command => ({
  ...ui(
    "ui.home.example",
    "Open a copy of an example",
    async (args) => {
      const name = stringArg(args, "name");
      if (name === undefined) return undefined;
      const path = await home.copyExample(name);
      if (path === undefined || (await home.open(path)) === undefined) return undefined;
      host.navigate(notebookPageUrl(path, { search: host.search() }));
      return path;
    },
    (args) => stringArg(args, "name") !== undefined,
  ),
  writes: true,
});
