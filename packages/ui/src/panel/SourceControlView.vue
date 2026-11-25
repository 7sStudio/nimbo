<!-- SourceControlView: the Source Control view of either page's side panel, as VS Code's: Initialize Repository outside one; the message box (Cmd Enter commits, its placeholder naming the branch) and Commit; Publish Branch for a branch without upstream, else Sync Changes with its counts while it is ahead or behind; the operation under way with git's progress and Cancel; a merge or rebase under way with Continue and Abort; then Merge Changes, Staged Changes and Changes (ScmGroup); a line for what is staged or changed outside a workspace that is a subfolder; "No changes" when the tree is clean; History last (a lazy chunk). The view's head (title, Refresh, More Actions, Hide) is the page's: ViewHead on the notebook page, Home's own header there. -->
<script setup lang="ts">
import { Check, CloudUpload, RefreshCw } from "@lucide/vue";
import { computed, defineAsyncComponent } from "vue";

import Button from "../primitives/button/Button.vue";
import { useGitStore } from "../store/git";
import { useUiStore } from "../store/ui";
import ScmGroup from "./ScmGroup.vue";

const HistorySection = defineAsyncComponent(() => import("./HistorySection.vue"));
const props = defineProps<{ mac: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const git = useGitStore();
const ui = useUiStore();
const repo = computed(() => git.repo);
const branch = computed(() => repo.value?.branch.name ?? repo.value?.branch.oid?.slice(0, 7) ?? "");
const placeholder = computed(
  () =>
    `Message (${props.mac ? "⌘" : "Ctrl+"}Enter to commit${branch.value === "" ? "" : ` on "${branch.value}"`})`,
);
const message = computed({
  get: () => git.message,
  set: (value: string) => {
    git.message = value;
  },
});
const clean = computed(
  () =>
    repo.value !== null &&
    repo.value.staged.length + repo.value.changes.length + repo.value.conflicts.length === 0,
);
const outside = computed(() => {
  const counts = repo.value?.outside;
  if (counts === undefined) return "";
  const parts = [
    counts.staged > 0 ? `${String(counts.staged)} staged` : "",
    counts.changes > 0 ? `${String(counts.changes)} changed` : "",
  ].filter(Boolean);
  return parts.length === 0 ? "" : `${parts.join(", ")} outside this folder`;
});
const stateWords: Readonly<Record<string, string>> = {
  merging: "Merging",
  rebasing: "Rebasing",
  cherryPicking: "Cherry-picking",
  reverting: "Reverting",
};
const state = computed(() => stateWords[repo.value?.state ?? "clean"] ?? "");
const publish = computed(() => {
  const at = repo.value?.branch;
  return at !== undefined && at.name !== null && at.oid !== null && at.upstream === null;
});
const sync = computed(() => {
  const at = repo.value?.branch;
  if (at?.upstream == null || at.ahead + at.behind === 0) return "";
  return `${at.behind > 0 ? `${String(at.behind)}↓ ` : ""}${at.ahead > 0 ? `${String(at.ahead)}↑` : ""}`.trim();
});
const current = computed(() => (ui.page === "diff" ? (ui.diff?.path ?? null) : null));
const send = (id: string, args?: Record<string, unknown>) => {
  emit("command", id, args);
};
</script>

<template>
  <div class="ui:flex ui:flex-1 ui:flex-col ui:overflow-y-auto ui:min-block-0" data-testid="scm">
    <div v-if="git.loaded && repo === null" class="ui:flex ui:flex-col ui:gap-1.5 ui:ps-1">
      <p class="ui:m-0 ui:text-small ui:text-muted">No repository</p>
      <Button variant="primary" data-testid="scm-init" @click="send('ui.git.init')">
        Initialize Repository
      </Button>
    </div>
    <template v-else-if="repo !== null">
      <div class="ui:flex ui:flex-col ui:gap-1.5 ui:ps-1 ui:pbe-2">
        <textarea
          v-model="message"
          rows="1"
          aria-label="Commit message"
          :placeholder="placeholder"
          data-testid="scm-message"
          class="ui:field-sizing-content ui:resize-none ui:rounded-control ui:border ui:border-border ui:bg-bg ui:px-2 ui:py-1 ui:font-inherit ui:text-ui ui:text-fg ui:max-block-40 ui:min-block-7 ui:focus-visible:border-accent"
          @keydown.meta.enter.prevent="send('ui.git.commit')"
          @keydown.ctrl.enter.prevent="send('ui.git.commit')"
        />
        <Button
          variant="primary"
          data-testid="scm-commit"
          :disabled="git.message.trim() === '' || clean"
          @click="send('ui.git.commit')"
        >
          <Check class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          Commit
        </Button>
        <Button
          v-if="publish"
          data-testid="scm-publish"
          :disabled="git.running !== null"
          @click="send('ui.git.publish')"
        >
          <CloudUpload class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          Publish Branch
        </Button>
        <Button
          v-else-if="sync !== ''"
          data-testid="scm-sync"
          :disabled="git.running !== null"
          @click="send('ui.git.sync')"
        >
          <RefreshCw class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          Sync Changes {{ sync }}
        </Button>
        <p
          v-if="git.running !== null"
          role="status"
          data-testid="scm-running"
          class="ui:m-0 ui:flex ui:items-center ui:gap-1 ui:text-tiny ui:text-muted ui:min-inline-0"
        >
          <span class="ui:flex-1 ui:ellipsis ui:min-inline-0">{{
            git.progress === "" ? `${git.running}…` : git.progress
          }}</span>
          <button
            type="button"
            class="ui:shrink-0 ui:cursor-pointer ui:border-0 ui:bg-transparent ui:p-0 ui:font-inherit ui:text-accent ui:hover:underline"
            @click="send('ui.git.cancel')"
          >
            Cancel
          </button>
        </p>
        <p
          v-if="state !== ''"
          data-testid="scm-state"
          class="ui:m-0 ui:flex ui:items-center ui:gap-2 ui:text-small ui:text-fg-2"
        >
          <span class="ui:flex-1">{{ state }}</span>
          <button
            type="button"
            class="ui:cursor-pointer ui:border-0 ui:bg-transparent ui:p-0 ui:font-inherit ui:text-accent ui:hover:underline"
            @click="send('ui.git.continue')"
          >
            Continue
          </button>
          <button
            type="button"
            data-testid="scm-abort"
            class="ui:cursor-pointer ui:border-0 ui:bg-transparent ui:p-0 ui:font-inherit ui:text-accent ui:hover:underline"
            @click="send('ui.git.abort')"
          >
            Abort
          </button>
        </p>
      </div>
      <p v-if="clean" class="ui:m-0 ui:ps-1 ui:pbs-1 ui:text-small ui:text-muted">No changes</p>
      <ScmGroup
        v-if="repo.conflicts.length > 0"
        kind="conflicts"
        title="Merge Changes"
        :changes="repo.conflicts"
        :current="current"
        @command="send"
      />
      <ScmGroup
        v-if="repo.staged.length > 0"
        kind="staged"
        title="Staged Changes"
        :changes="repo.staged"
        :current="current"
        @command="send"
      />
      <ScmGroup
        v-if="repo.changes.length > 0"
        kind="changes"
        title="Changes"
        :changes="repo.changes"
        :current="current"
        @command="send"
      />
      <p v-if="outside !== ''" class="ui:m-0 ui:ps-1 ui:pbs-2 ui:text-tiny ui:text-muted">
        {{ outside }}
      </p>
      <HistorySection v-if="repo.branch.oid !== null" @command="send" />
    </template>
  </div>
</template>
