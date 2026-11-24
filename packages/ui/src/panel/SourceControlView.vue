<!-- SourceControlView: the Source Control view of either page's side panel, as VS Code's: the message box (Cmd Enter commits, its placeholder naming the branch) and Commit; then Merge Changes (during a merge), Staged Changes and Changes (ScmGroup); a line for what is staged or changed outside a workspace that is a subfolder; "No changes" when the tree is clean. The view's head (title, Refresh, Hide) is the page's: ViewHead on the notebook page, Home's own header there. -->
<script setup lang="ts">
import { Check } from "@lucide/vue";
import { computed } from "vue";

import Button from "../primitives/button/Button.vue";
import { useGitStore } from "../store/git";
import { useUiStore } from "../store/ui";
import ScmGroup from "./ScmGroup.vue";

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
const current = computed(() => (ui.page === "diff" ? (ui.diff?.path ?? null) : null));
const send = (id: string, args?: Record<string, unknown>) => {
  emit("command", id, args);
};
</script>

<template>
  <div class="ui:flex ui:flex-1 ui:flex-col ui:overflow-y-auto ui:min-block-0" data-testid="scm">
    <p v-if="git.loaded && repo === null" class="ui:m-0 ui:ps-1 ui:text-small ui:text-muted">
      No repository
    </p>
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
    </template>
  </div>
</template>
