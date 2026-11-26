// Mounts the page the address names: the notebook page at /ui/<name>, the output tab at
// /ui/<name>/out/<execution>/<index>, or the Home page at /ui/, a chunk loaded only there. The stores start in their order (store/start.ts), the dispatcher is provided to
// the views, and the client realm is mounted once the notebook is hydrated; the output tab mounts no realm and loads
// the settings alone (its theme). The remembered theme is applied before anything mounts, so a dark page never paints
// light first.
// output-view's stylesheets are linked as sheets of their own, gated by its own package, never merged into ours: its
// views, and its theme, whose base gives a .jsnb-ov root its font and background where nothing of ours is around it
// (the full-screen dialog, which Reka teleports to <body>).
import outputViewSheet from "@jsnb/output-view/style.css?url";
import outputViewTheme from "@jsnb/output-view/theme.css?url";
import { createPinia, setActivePinia } from "pinia";
import { createApp, h } from "vue";

import App from "./App.vue";
import { createPageEngines } from "./cells/engines";
import { outputHostKey } from "./cells/outputHost";
import { createDispatcher, dispatcherKey } from "./commands/dispatch";
import OutputTab from "./overlays/OutputTab.vue";
import { mountRealm } from "./realm/mount";
import { pageAddress } from "./store/address";
import { fullValueFetcher, fullValuePath } from "./store/fullValue";
import { useSettingsStore } from "./store/settings";
import { startPage, startSession } from "./store/start";
import { moveLegacyStorageKeys } from "./store/storageKeys";
import { useUiStore } from "./store/ui";
import { applySyntaxTheme, rememberedSyntaxTheme } from "./theme/syntaxTheme";
import { applyTheme, rememberedTheme } from "./theme/theme";
import "./main.css";

for (const href of [outputViewTheme, outputViewSheet])
  document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href }));

moveLegacyStorageKeys(globalThis.localStorage);

// the first paint in the theme this browser last showed; the setting confirms or changes it once it loads
applyTheme(document.documentElement, rememberedTheme(globalThis.localStorage));
applySyntaxTheme(document.documentElement, rememberedSyntaxTheme(globalThis.localStorage));

const address = pageAddress(location);
const pinia = createPinia();
setActivePinia(pinia);

if (address === undefined) {
  document.body.textContent = "This is not a notebook page: open one with nimbo open <notebook>.";
} else if (address.home === true) {
  import("./home/mountHome").then(
    ({ mountHome }) => {
      mountHome(address, pinia);
    },
    (error: unknown) => {
      // a build the daemon no longer serves (upgraded under the page): nothing to mount, so say what to do
      document.body.textContent = `The Home page could not load (${String(error)}). Reload the page.`;
    },
  );
} else if (address.output !== undefined) {
  const { execution, index } = address.output;
  createApp(() =>
    h(OutputTab, {
      execution,
      index,
      fullValueUrl: fullValuePath(execution, index),
      fetchFullValue: fullValueFetcher(address),
    }),
  )
    .use(pinia)
    .mount("#app");
  void startSession(address).then(async (started) => {
    if (started) await useSettingsStore().start();
  });
} else {
  const host = {
    engines: createPageEngines(),
    fetchFullValue: fullValueFetcher(address),
    // the output's own tab carries the token like the page's address, for its socket's upgrade
    tabUrl: (execution: string, index: number) =>
      `${location.pathname.replace(/\/$/u, "")}/out/${encodeURIComponent(execution)}/${String(index)}${location.search}`,
  };
  createApp(App)
    .use(pinia)
    .provide(dispatcherKey, createDispatcher())
    .provide(outputHostKey, host)
    .mount("#app");
  void startPage(address).then((started) => {
    if (!started) return;
    mountRealm(document);
    selectLinkedCell();
  });
}

/** `#cell=<id>` (a diff's Open File at a cell from another page): that cell is selected once the
 * notebook has loaded, and the hash is dropped so a reload keeps the user's own selection. */
function selectLinkedCell(): void {
  const linked = /^#cell=(.+)$/u.exec(location.hash)?.[1];
  if (linked === undefined) return;
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  useUiStore().select(decodeURIComponent(linked));
}
