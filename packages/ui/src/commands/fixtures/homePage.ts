// The Home page's stores and dispatcher over a test's daemon, the way mountHome.ts makes them, with a recording
// browser: what home.integration.test.ts and homeRenames.integration.test.ts drive.
import type { Daemon } from "@jsnb/test-daemon";
import { createPinia, setActivePinia } from "pinia";

import { whenTrue } from "../../store/fixtures/page.js";
import { useHomeStore } from "../../store/home.js";
import { useSessionStore } from "../../store/socket.js";
import { useUiStore } from "../../store/ui.js";
import { createHomeDispatcher } from "../homeDispatch.js";

/** The Home page's stores over `daemon`, its dispatcher and where it sent the browser. */
export async function startHomePage(daemon: Daemon) {
  setActivePinia(createPinia());
  await useSessionStore().start(daemon.socket({ client: "ui" }), "", () => undefined);
  const home = useHomeStore();
  await home.start();
  const sent: string[] = [];
  const dispatcher = createHomeDispatcher({
    search: () => "?token=t",
    navigate: (url) => sent.push(url),
  });
  return { home, ui: useUiStore(), dispatcher, sent };
}

export const listed = (home: ReturnType<typeof useHomeStore>, path: string, open: boolean) =>
  whenTrue(() => home.notebooks.some((each) => each.path === path && each.open === open));
