<!-- An output's header: the toolbar with the find box (its keys / values / both scope in full
screen) and the copy and export menus in it, the query bar under it while open, and the line of long work. -->
<script setup lang="ts">
import CopyMenu from "./CopyMenu.vue";
import ExportMenu from "./ExportMenu.vue";
import OutputQueryBar from "./OutputQueryBar.vue";
import OutputToolbar from "./OutputToolbar.vue";
import SearchBox from "./SearchBox.vue";
import TaskLine from "./TaskLine.vue";
import type { Chrome } from "./useChrome.js";
import type { useOutputView } from "./useOutputView.js";

defineProps<{ readonly out: ReturnType<typeof useOutputView>; readonly chrome: Chrome }>();
</script>

<template>
  <OutputToolbar
    :wrap="chrome.switches.wrap.value"
    :times="chrome.switches.times.value"
    :raw="chrome.switches.raw.value"
    :view="
      out.shown.shown.value === 'grid' || out.shown.shown.value === 'raw'
        ? out.shown.shown.value
        : 'tree'
    "
    :state="chrome.toolbar.value"
    @update:view="out.layout.setView"
    @update:wrap="(on) => chrome.toggle('wrap', on)"
    @update:times="(on) => chrome.toggle('times', on)"
    @update:raw="(on) => chrome.toggle('raw', on)"
    @action="chrome.actions.run"
  >
    <SearchBox
      v-if="out.find.value"
      :text="out.search.text.value"
      :counter="out.search.counter.value"
      :error="out.search.error.value"
      :scope="out.search.scope.value"
      :scopes="out.nested"
      @update:text="chrome.actions.find"
      @update:scope="chrome.actions.scope"
      @step="chrome.actions.step"
      @close="chrome.actions.run('find')"
    />
    <template #menus>
      <CopyMenu :items="chrome.copyItems.value" />
      <ExportMenu
        v-if="out.shown.input.value && chrome.exportItems.value.length > 0"
        :input="out.shown.input.value"
        :items="chrome.exportItems.value"
        :fetch-full="chrome.fetchFull.value"
      />
    </template>
  </OutputToolbar>
  <OutputQueryBar
    v-if="chrome.engines.value && out.bar.open.value"
    :bar="out.bar"
    :engines="chrome.engines.value"
    :json="out.value.json.value"
    :keys="chrome.actions.keys.value"
    :schema="out.table.schema.value"
  />
  <TaskLine :tasks="out.tasks" />
</template>
