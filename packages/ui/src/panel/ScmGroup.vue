<!-- ScmGroup: one group of the Source Control view, as VS Code's: Merge Changes, Staged Changes or Changes with its count and its actions on hover (Stage All, Unstage All, Discard All); then a row per file: its icon, name and folder dimmed, the actions on hover (Open File for a notebook, Discard, Stage or Unstage) and the status letter. A click opens the file's diff; Up and Down move between rows; the right-click menu holds the same actions. -->
<script setup lang="ts">
import type { GitChange } from "@jsnb/core";
import { File, FileText, Minus, NotebookText, Plus, Undo2 } from "@lucide/vue";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "reka-ui";
import { computed, ref } from "vue";

import { menuPanel, menuRow } from "../app/appMenus";
import IconButton from "../primitives/icon-button/IconButton.vue";
import { overlayHost } from "../primitives/overlay";
import type { ScmGroupKind } from "./scmRows";
import { rowOf } from "./scmRows";
import Section from "./Section.vue";

const props = defineProps<{
  kind: ScmGroupKind;
  title: string;
  changes: readonly GitChange[];
  /** The path whose diff the main area shows, for the row's highlight. */
  current: string | null;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const rows = computed(() => props.changes.map(rowOf));
const all = computed(() => rows.value.map((row) => row.path));
const staged = computed(() => props.kind === "staged");
const icon = "ui:block-3.5 ui:inline-3.5";
const send = (id: string, args?: Record<string, unknown>) => {
  emit("command", id, args);
};
const open = (path: string) => {
  send("ui.diff.open", { path, staged: staged.value });
};
const target = ref<string | null>(null);
function aimed(event: MouseEvent): void {
  const row =
    event.target instanceof Element ? event.target.closest<HTMLElement>("[data-path]") : null;
  target.value = row?.dataset.path ?? null;
}
/** Up and Down between the group's rows, as a tree's arrows. */
function step(event: KeyboardEvent, by: 1 | -1): void {
  const buttons = [...document.querySelectorAll<HTMLElement>("[data-scm-row]")];
  const from = event.currentTarget;
  const at = from instanceof HTMLElement ? buttons.indexOf(from) : -1;
  buttons[at + by]?.focus();
}
/** The right-click menu's items: each a command and its arguments. */
const menu = computed(() => {
  const path = target.value;
  if (path === null) return [];
  const row = rows.value.find((each) => each.path === path);
  const paths = [path];
  const items: { label: string; id: string; args: Record<string, unknown> }[] = [
    { label: "Open Changes", id: "ui.diff.open", args: { path, staged: staged.value } },
  ];
  if (row?.notebook === true && !row.deleted)
    items.push({ label: "Open File", id: "ui.git.openFile", args: { path } });
  if (staged.value) items.push({ label: "Unstage Changes", id: "ui.git.unstage", args: { paths } });
  else {
    items.push({ label: "Stage Changes", id: "ui.git.stage", args: { paths } });
    items.push({ label: "Discard Changes", id: "ui.git.discard", args: { paths } });
  }
  return items;
});
</script>

<template>
  <Section :name="`scm-${props.kind}`" :title="props.title" :count="rows.length" hover-tools>
    <template #tools>
      <IconButton
        v-if="!staged"
        label="Discard All Changes"
        class="ui:block-6 ui:inline-6"
        @click="send('ui.git.discard', { paths: all })"
      >
        <Undo2 :class="icon" aria-hidden="true" />
      </IconButton>
      <IconButton
        :label="staged ? 'Unstage All Changes' : 'Stage All Changes'"
        class="ui:block-6 ui:inline-6"
        @click="send(staged ? 'ui.git.unstage' : 'ui.git.stage', { paths: all })"
      >
        <component :is="staged ? Minus : Plus" :class="icon" aria-hidden="true" />
      </IconButton>
    </template>
    <ContextMenuRoot :modal="false">
      <ContextMenuTrigger as-child @contextmenu="aimed">
        <ul :aria-label="props.title" class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0">
          <li
            v-for="row in rows"
            :key="row.path"
            :data-path="row.path"
            :data-current="props.current === row.path ? '' : undefined"
            class="ui:group ui:flex ui:items-center ui:gap-1.5 ui:rounded-small ui:ps-5 ui:pe-1 ui:text-fg-2 ui:block-[1.375rem] ui:hover:bg-well ui:data-current:bg-surface-2"
          >
            <component
              :is="row.notebook ? NotebookText : row.name.endsWith('.md') ? FileText : File"
              class="ui:shrink-0 ui:text-fill ui:block-3.5 ui:inline-3.5"
              aria-hidden="true"
            />
            <button
              type="button"
              data-scm-row
              :title="row.path"
              :class="[
                'ui:flex ui:flex-1 ui:cursor-pointer ui:items-baseline ui:gap-1.5 ui:border-0 ui:bg-transparent ui:p-0 ui:text-start ui:font-inherit ui:text-inherit ui:min-inline-0 ui:focus-visible:outline-accent',
                row.deleted ? 'ui:line-through' : '',
              ]"
              @click="open(row.path)"
              @keydown.down.prevent="(event: KeyboardEvent) => step(event, 1)"
              @keydown.up.prevent="(event: KeyboardEvent) => step(event, -1)"
            >
              <span class="ui:shrink-0 ui:ellipsis ui:text-fg ui:max-inline-full">{{
                row.name
              }}</span>
              <span class="ui:ellipsis ui:text-tiny ui:text-muted ui:min-inline-0">{{
                row.folder
              }}</span>
            </button>
            <span
              class="ui:hidden ui:items-center ui:group-hover:flex ui:group-has-focus-visible:flex"
            >
              <IconButton
                v-if="row.notebook && !row.deleted"
                label="Open File"
                class="ui:block-5 ui:inline-5"
                @click="send('ui.git.openFile', { path: row.path })"
              >
                <NotebookText class="ui:block-3 ui:inline-3" aria-hidden="true" />
              </IconButton>
              <IconButton
                v-if="!staged"
                label="Discard Changes"
                class="ui:block-5 ui:inline-5"
                @click="send('ui.git.discard', { paths: [row.path] })"
              >
                <Undo2 class="ui:block-3 ui:inline-3" aria-hidden="true" />
              </IconButton>
              <IconButton
                :label="staged ? 'Unstage Changes' : 'Stage Changes'"
                class="ui:block-5 ui:inline-5"
                @click="send(staged ? 'ui.git.unstage' : 'ui.git.stage', { paths: [row.path] })"
              >
                <component
                  :is="staged ? Minus : Plus"
                  class="ui:block-3 ui:inline-3"
                  aria-hidden="true"
                />
              </IconButton>
            </span>
            <span
              :title="row.title"
              :class="[
                'ui:shrink-0 ui:text-center ui:font-mono ui:text-tiny ui:font-semibold ui:inline-4',
                row.tone,
              ]"
              >{{ row.letter }}</span
            >
          </li>
        </ul>
      </ContextMenuTrigger>
      <ContextMenuPortal :to="overlayHost">
        <ContextMenuContent data-overlay="menu" :class="menuPanel">
          <ContextMenuItem
            v-for="item in menu"
            :key="item.label"
            :class="menuRow"
            @select="send(item.id, item.args)"
          >
            {{ item.label }}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenuRoot>
  </Section>
</template>
