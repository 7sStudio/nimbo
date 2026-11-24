<!-- FolderPicker: Home's Open folder, a dialog on OverlayDialog. A path field to type or paste into (Enter goes there), then the folders of that path as rows (the parent first, each with how many notebooks it holds directly; Up and Down move, Enter or a double click enters), the recent folders beside them, and what opening this folder means in words: its notebooks, the workspace it belongs to, or that it is the one open here. "Open" (Cmd Enter) makes it the workspace; while notebooks are open here it first asks, in words, whether to close them. A path that is not a readable folder, or an open that fails, says why where the list was. Square, separated by tone. -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { useDispatcher } from "../commands/dispatch";
import { leavingWords } from "../commands/homeFolders";
import { keyWords } from "../keyboard/keymap";
import { isMac } from "../keyboard/modes";
import OverlayDialog from "../overlays/OverlayDialog.vue";
import Button from "../primitives/button/Button.vue";
import Kbd from "../primitives/kbd/Kbd.vue";
import { useHomeStore } from "../store/home";
import type { FolderListing } from "../store/homeFolders";
import type { Overlay } from "../store/overlay";
import { useUiStore } from "../store/ui";
import FolderList from "./FolderList.vue";
import FolderRecent from "./FolderRecent.vue";
import { pickerNote, pickerRows } from "./folderRows";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "folderPicker" }> }>();
const dispatcher = useDispatcher();
const home = useHomeStore();
const ui = useUiStore();
const mac = isMac(navigator.userAgent);

const typed = ref(props.overlay.path ?? "");
const listing = ref<FolderListing | null>(null);
const error = ref<string | null>(null);
const selected = ref(0);
const confirming = ref(props.overlay.confirm === true);
const opening = ref(false);
const field = ref<HTMLInputElement | null>(null);
const list = ref<InstanceType<typeof FolderList> | null>(null);

const rows = computed(() => (listing.value === null ? [] : pickerRows(listing.value)));
const note = computed(() => (listing.value === null ? "" : pickerNote(listing.value)));
const leaving = computed(() => leavingWords(home));
const recent = computed(() => home.recentFolders.filter((folder) => folder.exists));
const closeAndOpen = computed(() =>
  home.notebooks.filter((each) => each.open).length === 1
    ? "Close it and open"
    : "Close them and open",
);

/** Lists `path` (the workspace folder without one); the field then says where the listing is. */
async function go(path?: string, keepConfirm = false): Promise<void> {
  error.value = null;
  confirming.value = keepConfirm && confirming.value;
  const answer = await home.listFolders(path);
  if ("error" in answer) {
    error.value = answer.error;
    return;
  }
  listing.value = answer.listing;
  typed.value = answer.listing.path;
  selected.value = 0;
}

/** Opens the folder listed, asking first while notebooks are open here. */
async function open(): Promise<void> {
  const at = listing.value;
  if (at === null || at.current || opening.value) return;
  if (leaving.value !== null && !confirming.value) {
    confirming.value = true;
    return;
  }
  opening.value = true;
  const answer = await dispatcher.request("ui.home.openFolder", {
    path: at.path,
    confirmed: true,
    fromPicker: true,
  });
  opening.value = false;
  if (answer !== null && typeof answer === "object" && "error" in answer)
    error.value = String(answer.error);
}

const enter = (at: number): void => {
  const row = rows.value[at];
  if (row !== undefined) void go(row.path);
};
function move(by: 1 | -1): void {
  const count = rows.value.length;
  if (count > 0) selected.value = (selected.value + by + count) % count;
}
function up(): void {
  if (listing.value?.parent) void go(listing.value.parent);
}
function onFieldKey(event: KeyboardEvent): void {
  if (event.key === "Enter" && !(event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void go(typed.value.trim() === "" ? undefined : typed.value);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    list.value?.focus();
  }
}
function onKey(event: KeyboardEvent): void {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void open();
  }
}
onMounted(() => {
  void home.loadRecent();
  void go(props.overlay.path, true);
  field.value?.focus();
});
const close = () => {
  ui.overlay = null;
};
</script>

<template>
  <OverlayDialog
    :overlay="props.overlay"
    title="Open Folder"
    width="ui:max-inline-[min(50rem,calc(100%-2rem))]"
  >
    <div class="ui:flex ui:flex-col ui:gap-3 ui:min-inline-0" @keydown="onKey">
      <label class="ui:flex ui:flex-col ui:gap-1">
        <span class="ui:text-tiny ui:text-muted">Path</span>
        <input
          ref="field"
          v-model="typed"
          data-testid="folder-path"
          spellcheck="false"
          autocomplete="off"
          class="ui:border ui:border-transparent ui:bg-sheet ui:px-2 ui:font-mono ui:text-[0.75rem] ui:text-fg ui:block-8 ui:min-inline-0"
          @keydown="onFieldKey"
        />
      </label>
      <div class="ui:grid ui:grid-cols-[minmax(0,1fr)_14rem] ui:gap-3 ui:min-inline-0">
        <div class="ui:flex ui:flex-col ui:gap-1 ui:min-inline-0">
          <p v-if="error !== null" class="ui:m-0 ui:text-ui ui:text-err" data-testid="folder-error">
            {{ error }}
          </p>
          <FolderList
            v-else
            ref="list"
            :rows="rows"
            :selected="selected"
            :listing="listing"
            @select="(at) => (selected = at)"
            @enter="enter"
            @move="move"
            @up="up"
          />
        </div>
        <FolderRecent :folders="recent" @go="go" />
      </div>
      <p
        v-if="confirming && leaving !== null"
        role="alert"
        class="ui:m-0 ui:bg-well ui:px-3 ui:py-2 ui:text-ui ui:text-fg"
        data-testid="folder-leaving"
      >
        {{ leaving }}
      </p>
      <p v-else class="ui:m-0 ui:text-small ui:text-muted" data-testid="folder-note">{{ note }}</p>
    </div>
    <template #footer>
      <Button @click="confirming ? (confirming = false) : close()">{{
        confirming ? "Keep this folder" : "Cancel"
      }}</Button>
      <Button
        variant="go"
        data-testid="open-folder"
        :disabled="listing === null || listing.current || error !== null || opening"
        @click="open"
        >{{ confirming ? closeAndOpen : "Open"
        }}<Kbd class="ui:text-current">{{ keyWords("Mod+Enter", mac) }}</Kbd></Button
      >
    </template>
  </OverlayDialog>
</template>
