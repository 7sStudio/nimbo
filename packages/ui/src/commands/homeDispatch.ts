// The Home page's dispatcher: the same Dispatcher the notebook page provides, so the palette,
// the toasts and the keyboard work unchanged, over Home's commands and the theme toggle. A command that writes runs
// only while the socket is live; Home attaches no page, so nothing else refuses it.
import { useHomeStore } from "../store/home.js";
import { shortPath } from "../store/homeFolders.js";
import type { NewToast } from "../store/toasts.js";
import { useSessionStore } from "../store/socket.js";
import { useUiStore } from "../store/ui.js";
import type { Args, Command } from "./command.js";
import { uiCommand } from "./command.js";
import type { Dispatcher } from "./dispatch.js";
import type { HomeHost } from "./homeHost.js";
import { homeCommands } from "./home.js";
import { appCommands, askSettingsFirst } from "./app.js";

const notConnected: NewToast = {
  kind: "info",
  title: "Not connected",
  text: "Creating, opening, renaming and deleting notebooks wait for the daemon.",
};

/** Each recent folder that is still there and is not this one, and each shipped lesson and example, as the palette
 * offers them. */
const paletteEntries = (home: ReturnType<typeof useHomeStore>) => [
  ...home.recentFolders
    .filter((folder) => folder.exists && !folder.current)
    .map((folder, _, shown) => ({
      command: "ui.home.openFolder",
      title: `Open recent folder: ${shortPath(
        folder.path,
        shown.map((each) => each.path),
      )}`,
      args: { path: folder.path },
    })),
  ...home.lessons.map((lesson) => ({
    command: "ui.home.example",
    title: `Open a copy of the lesson: ${lesson.title}`,
    args: { name: lesson.name },
  })),
  ...home.examples.map((example) => ({
    command: "ui.home.example",
    title: `Open a copy of the example: ${example.title}`,
    args: { name: example.name },
  })),
];

/** Go to Home on Home itself (the wordmark, the palette): back to the notebook list from the Settings editor, any
 * dialog or the palette closed, as the notebook page's `ui.home.open` lands on the list. */
const homeOpen = (ui: ReturnType<typeof useUiStore>): Command =>
  uiCommand("ui.home.open", "Go to Home", () => {
    if (askSettingsFirst(ui, "ui.home.open")) return;
    ui.closePalette();
    ui.overlay = null;
    ui.page = null;
  });

export function createHomeDispatcher(host: HomeHost): Dispatcher {
  const ui = useUiStore();
  const home = useHomeStore();
  const session = useSessionStore();
  const commands = [...homeCommands(host), ...appCommands(), homeOpen(ui)];
  const byId = new Map(commands.map((command) => [command.id, command]));
  const refused = (command: Command) => command.writes === true && session.status !== "live";
  const run = async (id: string, args?: Args): Promise<{ ran: boolean; answer?: unknown }> => {
    const command = byId.get(id);
    if (command === undefined || command.when?.(args) === false) return { ran: false };
    if (refused(command)) {
      ui.toast(notConnected);
      return { ran: false };
    }
    return { ran: true, answer: await command.run(args) };
  };
  return {
    commands,
    find: (id) => byId.get(id),
    available: (id, args) => {
      const command = byId.get(id);
      return command !== undefined && command.when?.(args) !== false && !refused(command);
    },
    dispatch: async (id, args) => (await run(id, args)).ran,
    request: async (id, args) => (await run(id, args)).answer,
    context: () => ({
      mode: ui.mode,
      cellType: null,
      overlay: ui.palette.open || ui.overlay !== null,
      page: ui.page !== null,
    }),
    entries: () => paletteEntries(home),
  };
}
