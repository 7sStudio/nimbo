<!-- HistorySection: the Source Control view's History, as VS Code's Source Control Graph: a collapsible section of the branch's commits (or one file's, its name in the head with a clear button), subject with author and date dimmed, Load More at the end; a click opens a commit's files, and a file's click its diff against the commit's parent; its right-click menu also compares it with the working tree. Read again when the branch's commit changes. -->
<script setup lang="ts">
import { ChevronDown, ChevronRight, GitCommitHorizontal, X } from "@lucide/vue";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "reka-ui";
import { computed, onMounted, ref, watch } from "vue";

import { menuPanel, menuRow } from "../app/appMenus";
import { overlayHost } from "../primitives/overlay";

import IconButton from "../primitives/icon-button/IconButton.vue";
import Section from "./Section.vue";
import { useGitStore } from "../store/git";
import { useHistoryStore } from "../store/history";

const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const git = useGitStore();
const history = useHistoryStore();
const head = computed(() => git.repo?.branch.oid ?? null);
const title = computed(() =>
  history.path === null
    ? "History"
    : `History: ${history.path.slice(history.path.lastIndexOf("/") + 1)}`,
);
const ago = (date: string): string => {
  const days = Math.floor((Date.now() - Date.parse(date)) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${String(days)}d`;
  return date.slice(0, 10);
};
const openFile = (oid: string, path: string) => {
  emit("command", "ui.diff.open", { path, commit: oid });
};
/** The file the right-click menu acts on. */
const aimed = ref<{ oid: string; path: string } | null>(null);
const menu = computed(() => {
  const at = aimed.value;
  if (at === null) return [];
  return [
    { label: "Open Changes", id: "ui.diff.open", args: { path: at.path, commit: at.oid } },
    {
      label: "Compare with Working Tree",
      id: "ui.diff.open",
      args: { path: at.path, base: at.oid },
    },
    { label: "Open File History", id: "ui.git.fileHistory", args: { path: at.path } },
  ];
});
const icon = "ui:block-3.5 ui:inline-3.5 ui:shrink-0";
onMounted(() => {
  if (history.commits.length === 0) void history.reload();
});
// Side effect: a commit, a pull or a switch moves HEAD; the list follows it.
watch(head, () => void history.reload());
</script>

<template>
  <Section
    name="scm-history"
    :title="title"
    :empty="history.commits.length === 0"
    hover-tools
    data-testid="scm-history"
  >
    <template #tools>
      <IconButton
        v-if="history.path !== null"
        label="Show Branch History"
        class="ui:block-5 ui:inline-5"
        @click="history.show(null)"
      >
        <X :class="icon" aria-hidden="true" />
      </IconButton>
    </template>
    <ContextMenuRoot :modal="false">
      <ContextMenuTrigger as-child>
        <ul class="ui:m-0 ui:list-none ui:p-0" aria-label="Commits">
          <li v-for="commit in history.commits" :key="commit.oid">
            <button
              type="button"
              data-testid="scm-commit-row"
              :title="`${commit.short} · ${commit.author} · ${commit.date.slice(0, 16).replace('T', ' ')}\n${commit.subject}`"
              class="ui:flex ui:cursor-pointer ui:items-center ui:gap-1 ui:border-0 ui:bg-transparent ui:ps-1 ui:pe-2 ui:text-start ui:font-inherit ui:text-small ui:text-fg ui:block-5.5 ui:inline-full ui:hover:bg-well"
              @click="history.toggle(commit.oid)"
            >
              <component
                :is="history.open.has(commit.oid) ? ChevronDown : ChevronRight"
                :class="icon"
                aria-hidden="true"
              />
              <GitCommitHorizontal :class="[icon, 'ui:text-muted']" aria-hidden="true" />
              <span class="ui:flex-1 ui:ellipsis ui:min-inline-0">{{ commit.subject }}</span>
              <span class="ui:shrink-0 ui:text-tiny ui:text-muted">{{ commit.author }}</span>
              <span class="ui:shrink-0 ui:text-tiny ui:text-muted ui:tabular-nums">{{
                ago(commit.date)
              }}</span>
            </button>
            <ul
              v-if="history.open.has(commit.oid)"
              class="ui:m-0 ui:list-none ui:p-0"
              :aria-label="`Files of ${commit.short}`"
            >
              <li v-for="file in history.open.get(commit.oid)?.files ?? []" :key="file.path">
                <button
                  type="button"
                  data-testid="scm-commit-file"
                  class="ui:flex ui:cursor-pointer ui:items-center ui:gap-1 ui:border-0 ui:bg-transparent ui:ps-9 ui:pe-2 ui:text-start ui:font-inherit ui:text-small ui:text-fg ui:block-5.5 ui:inline-full ui:hover:bg-well"
                  @click="openFile(commit.oid, file.path)"
                  @contextmenu="aimed = { oid: commit.oid, path: file.path }"
                >
                  <span class="ui:flex-1 ui:ellipsis ui:min-inline-0">{{ file.path }}</span>
                  <span class="ui:shrink-0 ui:text-tiny ui:text-muted">{{
                    file.status.charAt(0).toUpperCase()
                  }}</span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </ContextMenuTrigger>
      <ContextMenuPortal :to="overlayHost">
        <ContextMenuContent v-if="menu.length > 0" data-overlay="menu" :class="menuPanel">
          <ContextMenuItem
            v-for="item in menu"
            :key="item.label"
            :class="menuRow"
            @select="emit('command', item.id, item.args)"
            >{{ item.label }}</ContextMenuItem
          >
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenuRoot>
    <p
      v-if="!history.loading && history.commits.length === 0"
      class="ui:m-0 ui:ps-1 ui:text-small ui:text-muted"
    >
      No commits
    </p>
    <button
      v-if="history.more"
      type="button"
      class="ui:cursor-pointer ui:border-0 ui:bg-transparent ui:ps-6 ui:text-small ui:text-accent ui:block-5.5 ui:hover:underline"
      @click="history.loadMore()"
    >
      Load More
    </button>
  </Section>
</template>
