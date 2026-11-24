// The Home page's start, a chunk of its own that only /ui/ loads: the socket to the daemon
// the page came from, the session over it with no notebook, then the settings (the theme) and the Home store, which
// subscribes to the workspace stream; no realm is mounted. A start that stops (a stale token) is kept as the
// session's failure, which the page shows as its one banner, and no list is read.
import type { Pinia } from "pinia";
import { createApp } from "vue";

import { createHomeDispatcher } from "../commands/homeDispatch";
import { dispatcherKey } from "../commands/dispatch";
import type { PageAddress } from "../store/address";
import { usePageReport } from "../store/attempt";
import { useHomeStore } from "../store/home";
import { useGitStore } from "../store/git";
import { useSettingsStore } from "../store/settings";
import { useKeybindingsStore } from "../store/keybindings";
import { openSocket, useSessionStore } from "../store/socket";
import Home from "./Home.vue";

/** Opens the session for the Home page and loads what it shows; false when the start stopped. */
export async function startHome(address: PageAddress): Promise<boolean> {
  const session = useSessionStore();
  try {
    await session.start(openSocket(address), "", usePageReport());
  } catch (error) {
    session.stop();
    session.failure = error;
    return false;
  }
  await Promise.all([
    useSettingsStore().start(),
    useKeybindingsStore().start(),
    useHomeStore().start(),
  ]);
  void useGitStore().start(); // the Source Control view's status, not waited for
  return true;
}

/** Mounts the Home page on #app and starts it. */
export function mountHome(address: PageAddress, pinia: Pinia): void {
  createApp(Home)
    .use(pinia)
    .provide(
      dispatcherKey,
      createHomeDispatcher({
        search: () => location.search,
        navigate: (url) => {
          location.assign(url);
        },
      }),
    )
    .mount("#app");
  void startHome(address);
}
