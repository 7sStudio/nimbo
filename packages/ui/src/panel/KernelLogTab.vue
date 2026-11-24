<!-- KernelLogTab: the bottom panel's Kernel log tab: the log file's path with Copy path and Refresh, then its last lines from kernel.log, mono and scrollable with the last ones in view, a note when earlier lines are not shown, "Could not read the log" when the daemon refused. Read when the tab opens and on Refresh. -->
<script setup lang="ts">
import { nextTick, ref } from "vue";

import { useDispatcher } from "../commands/dispatch";
import { copyText } from "../store/clipboard";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import type { KernelLog } from "./kernelLog";
import { kernelLogOf } from "./kernelLog";
import { wordButton } from "./rows";
import { whenStarted } from "./whenStarted";

const dispatcher = useDispatcher();
const ui = useUiStore();
const log = ref<KernelLog | "loading" | "failed">("loading");
const box = ref<HTMLElement | null>(null);

async function read(): Promise<void> {
  log.value = kernelLogOf(await dispatcher.request("kernel.log")) ?? "failed";
  await nextTick();
  box.value?.scrollTo({ top: box.value.scrollHeight });
}
whenStarted(useNotebookStore(), read);
</script>

<template>
  <div class="ui:flex ui:flex-1 ui:flex-col ui:gap-1 ui:min-block-0">
    <p v-if="log === 'failed'" role="alert" class="ui:m-0 ui:px-1 ui:text-err">
      Could not read the log.
    </p>
    <template v-else-if="log !== 'loading'">
      <div class="ui:flex ui:items-center ui:gap-2 ui:px-1 ui:min-inline-0">
        <code
          data-testid="log-path"
          class="ui:ellipsis ui:font-mono ui:text-tiny ui:text-muted ui:min-inline-0"
          >{{ log.path }}</code
        >
        <button type="button" :class="wordButton" @click="copyText(ui, log.path, 'the path')">
          Copy path
        </button>
        <button type="button" :class="wordButton" @click="read">Refresh</button>
        <span v-if="log.truncated" class="ui:text-tiny ui:text-muted">Earlier lines not shown</span>
      </div>
      <pre
        ref="box"
        tabindex="0"
        aria-label="The last lines of the kernel log"
        data-testid="log-lines"
        class="ui:m-0 ui:flex-1 ui:overflow-auto ui:px-1 ui:font-mono ui:text-[0.71875rem] ui:leading-[1.3rem] ui:whitespace-pre ui:text-fg ui:min-block-0"
        >{{ log.lines.join("\n") }}</pre>
    </template>
  </div>
</template>
