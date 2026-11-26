<!-- An error: name and message first, the source excerpt with its caret when the error has one,
frames mapped to the cell with "Jump", package frames named, Node-internal frames folded, the cause chain, `data` as a
tree, and the raw stack on demand. -->
<script setup lang="ts">
import type { ErrorInfo, Frame } from "@jsnb/core";
import { computed, ref } from "vue";

import { errorModel, frameLocation, frameWords } from "../model/frames.js";
import { useViewer } from "./context.js";
import Icon from "./Icon.vue";
import ValueTree from "./ValueTree.vue";
import TextButton from "./TextButton.vue";

const props = defineProps<{ readonly error: ErrorInfo; readonly showRaw?: boolean | undefined }>();
const { jump } = useViewer();
const model = computed(() => errorModel(props.error));
const opened = ref<ReadonlySet<number>>(new Set());
const toggle = (index: number): void => {
  const next = new Set(opened.value);
  if (!next.delete(index)) next.add(index);
  opened.value = next;
};
const go = (frame: Frame): void => {
  if (frame.cell !== undefined) jump({ cell: frame.cell, line: frame.line, col: frame.col });
};
</script>

<template>
  <!-- one column as wide as the output, the head, the frames, the causes and the data spaced by its gap: a long message,
  path or name wraps anywhere rather than run out of it -->
  <div
    data-part="error"
    class="ov:grid ov:grid-cols-[minmax(0,1fr)] ov:gap-1 ov:px-2 ov:py-1 ov:font-mono ov:text-value ov:leading-code ov:wrap-anywhere"
  >
    <p data-part="error-head" class="ov:m-0 ov:text-err">
      <strong data-part="error-name" class="ov:font-semibold">{{ model.name }}</strong
      >: {{ model.message }}
    </p>
    <pre
      v-if="model.excerpt !== undefined"
      data-part="error-excerpt"
      class="ov:m-0 ov:whitespace-pre ov:overflow-x-auto ov:text-fg-2"
      >{{ model.excerpt }}</pre>
    <pre v-if="showRaw" data-part="error-raw" class="ov:m-0 ov:whitespace-pre-wrap ov:text-fg-2">{{
      error.raw
    }}</pre>
    <!-- Frames and causes are keyed by their place in the stack: it never changes under the view, and a recursive
    stack repeats a location, so a location is not unique. -->
    <ol v-else data-part="frames" class="ov:m-0 ov:list-none ov:p-0">
      <li
        v-for="(group, index) in model.groups"
        :key="index"
        data-part="frame"
        class="ov:flex ov:flex-wrap ov:items-center ov:gap-2 ov:text-fg-2"
        :data-kind="group.kind"
      >
        <template v-if="group.kind === 'cell'">
          <span>{{ frameWords(group.frame) }}</span>
          <TextButton @click="go(group.frame)">Jump</TextButton>
        </template>
        <template v-else-if="group.kind === 'internal'">
          <TextButton :aria-expanded="opened.has(index)" @click="toggle(index)">
            <Icon :name="opened.has(index) ? 'chevronDown' : 'chevronRight'" />
            {{ group.frames.length }} internal Node frame{{ group.frames.length === 1 ? "" : "s" }}
          </TextButton>
          <ol v-if="opened.has(index)" data-part="frames" class="ov:m-0 ov:list-none ov:p-0">
            <li
              v-for="(frame, at) in group.frames"
              :key="at"
              data-part="frame"
              class="ov:flex ov:flex-wrap ov:items-center ov:gap-2 ov:text-fg-2"
            >
              {{ frameLocation(frame) }}
            </li>
          </ol>
        </template>
        <template v-else>
          <span>{{ frameLocation(group.frame) }}</span>
          <span
            v-if="group.kind === 'package'"
            data-part="package"
            class="ov:font-sans ov:text-meta"
            >in {{ group.name }}</span
          >
        </template>
      </li>
    </ol>
    <p
      v-for="(cause, index) in model.causes"
      :key="index"
      data-part="cause"
      class="ov:m-0 ov:text-err"
    >
      caused by <strong data-part="error-name" class="ov:font-semibold">{{ cause.name }}</strong
      >: {{ cause.message }}
    </p>
    <ValueTree v-if="model.data" :json="model.data" label="error data" :expand-depth="1" />
  </div>
</template>
