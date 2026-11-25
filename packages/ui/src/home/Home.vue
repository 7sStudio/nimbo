<!-- Home: the page at /ui/, laid out as VS Code's window: the title bar (menus, the command center naming the workspace), the connection's banners, then the activity bar, the Explorer (the notebooks as a tree, the running kernels) and the notebook list; the status bar last. The Explorer resizes by dragging the gap beside it (a double click resets) and hides (its icon, Cmd B), kept per browser. The list follows the workspace stream and is read again when the window gains focus. The keys are the live registry's for Home (keyboard/keymap.ts); the search field keeps its own keys. -->
<script setup lang="ts">
import { syntaxThemeOf } from "../theme/syntaxTheme";
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, watchEffect } from "vue";

import Banners from "../app/Banners.vue";
import Grip from "../app/Grip.vue";
import Toasts from "../app/Toasts.vue";
import { baseName } from "../app/models";
import { useAnnouncer } from "../app/useAnnouncer";
import { usePageTheme } from "../app/usePageTheme";
import { useDispatcher } from "../commands/dispatch";
import { useLongWait } from "../composables/useLongWait";
import { useNow } from "../composables/useNow";
import { homeMenus, themeOf } from "../app/appMenus";
import TitleBar from "../app/TitleBar.vue";
import { isMac } from "../keyboard/modes";
import { useShortcuts } from "../keyboard/useShortcuts";
import { useKeybindings } from "../app/useKeybindings";
import Overlays from "../overlays/Overlays.vue";
import TooltipProvider from "../primitives/tooltip/TooltipProvider.vue";
import { failureName } from "../app/startFailure";
import { useGitStore } from "../store/git";
import { useHomeStore } from "../store/home";
import { folderRows, shownOrder } from "../store/homeView";
import { bounds } from "../store/layout";
import { useSettingsStore } from "../store/settings";
import { useSessionStore } from "../store/socket";
import { useUiStore } from "../store/ui";
import HomeList from "./HomeList.vue";
import HomeRail from "./HomeRail.vue";
import HomeSide from "./HomeSide.vue";
import HomeStatus from "./HomeStatus.vue";
import { homeBanners } from "./homeBanners";
import { useHomePanels } from "./useHomePanels";

const SettingsPage = defineAsyncComponent(() => import("../panel/SettingsPage.vue"));
const DiffPage = defineAsyncComponent(() => import("../diff/DiffPage.vue"));
const HomeScm = defineAsyncComponent(() => import("./HomeScm.vue"));
const KeybindingsPage = defineAsyncComponent(() => import("../panel/KeybindingsPage.vue"));
const dispatcher = useDispatcher();
const home = useHomeStore();
const session = useSessionStore();
const settings = useSettingsStore();
const ui = useUiStore();
const announced = useAnnouncer();
const mac = isMac(navigator.userAgent);
useKeybindings();
useShortcuts(dispatcher, "home");
usePageTheme(document.documentElement, globalThis.localStorage);

const run = (id: string, args?: Record<string, unknown>) => void dispatcher.dispatch(id, args);
const open = computed(() => home.notebooks.filter((each) => each.open).map((each) => each.path));
const busy = computed(() => Object.values(home.kernels).some((kernel) => kernel.state === "busy"));
// the elapsed time ticks while a kernel is busy; the relative times are redrawn every half minute
const busyNow = useNow(() => busy.value, 1000);
const listNow = useNow(() => true, 30_000);
const now = computed(() => Math.max(busyNow.value, listNow.value));
const folders = computed(() => folderRows(home.notebooks));
const daemon = computed(() => home.daemon);
const reconnectingLong = useLongWait(() => session.status === "reconnecting", 15_000);
const banners = computed(() =>
  homeBanners({
    failure: failureName(session.failure),
    stopped: session.failure !== null,
    connection: session.status,
    reconnectingLong: reconnectingLong.value,
  }),
);
const theme = computed(() => themeOf(settings.valueOf("ui.theme")));
const menus = computed(() =>
  homeMenus(home.examples, theme.value, syntaxThemeOf(settings.valueOf("editor.syntaxTheme"))),
);

const { widthOf, resize } = useHomePanels();
const git = useGitStore();
/** The changed files on the Source Control icon; null hides it (no repository, or git.enabled off). */
const scmChanges = computed(() =>
  !git.loaded || settings.valueOf("git.enabled") === false ? null : git.count,
);
const scmBranch = computed(() => {
  if (scmChanges.value === null || git.repo === null) return null;
  const name = git.repo.branch.name ?? git.repo.branch.oid?.slice(0, 7) ?? "";
  return `${name}${git.dirty ? "*" : ""}`;
});

// Side effect: the window's title names the workspace's folder, as VS Code's does
watchEffect(() => {
  const folder = baseName(daemon.value?.root ?? "");
  document.title = folder === "" ? "nimbo" : `${folder} \u2014 nimbo`;
});
// Side effect: a folder picked in the Workspace panel that is gone (its last notebook deleted or moved) shows all.
watchEffect(() => {
  if (home.folder !== "" && !folders.value.some((row) => row.folder === home.folder))
    home.folder = "";
});
// Side effect: the list is read again when the window gains focus (no file watcher in v1).
const refocus = () => {
  if (session.current !== null) void home.refresh();
};
onMounted(() => {
  window.addEventListener("focus", refocus);
  // File > New Notebook on a notebook page lands here with #new: the name field asks for the new notebook's name
  if (location.hash === "#new") {
    history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    void dispatcher.dispatch("ui.notebook.new");
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("focus", refocus);
});
</script>

<template>
  <div class="jsnb-ui">
    <TooltipProvider>
      <div
        data-slot="shell"
        class="ui:grid ui:grid-cols-[minmax(0,1fr)] ui:grid-rows-[var(--bar)_auto_minmax(0,1fr)_var(--footer)] ui:overflow-clip ui:bg-ground ui:font-sans ui:text-ui ui:text-fg ui:tabular-nums ui:block-dvh ui:min-inline-[75rem]"
      >
        <div class="ui:min-inline-0">
          <TitleBar
            :menus="menus"
            :place="baseName(daemon?.root ?? '') || 'nimbo'"
            :place-title="daemon?.root ?? ''"
            :palette-open="ui.palette.open"
            :mac="mac"
            @command="run"
          />
        </div>
        <div class="ui:min-inline-0"><Banners :banners="banners" @command="run" /></div>
        <div data-slot="body" class="ui:flex ui:pe-1.5 ui:min-block-0 ui:min-inline-0">
          <div
            data-slot="rail"
            class="ui:shrink-0 ui:overflow-clip ui:inline-(--bar) ui:min-block-0"
          >
            <HomeRail
              :open="home.layout.side.open ? home.layout.side.view : null"
              :changes="scmChanges"
              :theme="theme"
              :mac="mac"
              @command="run"
            />
          </div>
          <template v-if="home.layout.side.open">
            <aside
              id="side"
              aria-labelledby="side-title"
              :style="widthOf('side')"
              class="ui:flex ui:shrink-0 ui:flex-col ui:overflow-clip ui:bg-side ui:px-2 ui:pbe-3 ui:min-block-0"
            >
              <HomeScm
                v-if="home.layout.side.view === 'sourceControl' && scmChanges !== null"
                :mac="mac"
                @command="run"
              />
              <HomeSide v-else :folder="baseName(daemon?.root ?? '')" :mac="mac" @command="run" />
            </aside>
            <Grip
              controls="side"
              name="Explorer"
              edge="left"
              :size="home.layout.side.size"
              :bounds="bounds.side"
              @resize="(rem) => resize('side', rem)"
            />
          </template>
          <div v-else aria-hidden="true" class="ui:shrink-0 ui:inline-1" />
          <main
            id="page"
            tabindex="-1"
            aria-label="Notebooks"
            class="ui:flex ui:flex-1 ui:flex-col ui:overflow-clip ui:bg-sheet-2 ui:min-block-0 ui:min-inline-0"
          >
            <SettingsPage v-if="ui.page === 'settings'" :off="false" @command="run" />
            <DiffPage v-else-if="ui.page === 'diff'" @command="run" />
            <KeybindingsPage v-else-if="ui.page === 'keybindings'" :off="false" @command="run" />
            <HomeList v-else :now="now" :mac="mac" @command="run" />
          </main>
        </div>
        <div class="ui:min-inline-0">
          <HomeStatus
            :root="daemon?.root ?? ''"
            :notebooks="home.notebooks.length"
            :shown="shownOrder(home).length"
            :running="open.length"
            :version="daemon?.serverVersion ?? ''"
            :pid="daemon?.pid ?? null"
            :loaded="home.loaded"
            :branch="scmBranch"
            @command="run"
          />
        </div>
      </div>
      <Overlays />
      <Toasts
        :toasts="ui.toasts"
        @command="run"
        @dismiss="ui.dismiss"
        @pause="ui.pause"
        @resume="ui.resume"
      />
    </TooltipProvider>
    <p aria-live="polite" class="ui:visually-hidden" data-testid="announcer">{{ announced }}</p>
  </div>
</template>
