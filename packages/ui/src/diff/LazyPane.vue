<!-- LazyPane: mounts a read-only editor or a merge editor (mergeSetup.ts) once it nears the viewport and again when its text or layout changes, so a notebook with a hundred changed cells opens at once; an empty side reads "empty". -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { EditorLanguage } from "../editor/setup";
import { mountDiff, mountText } from "./mergeSetup";

const props = defineProps<{
  /** One text (an added, removed or unchanged cell), or both sides of a modified one. */
  text?: string;
  before?: string;
  after?: string;
  language: EditorLanguage | null;
  sideBySide: boolean;
  label: string;
}>();
const host = ref<HTMLElement | null>(null);
let mounted: { readonly destroy: () => void } | null = null;
let seen = false;
let turn = 0;

async function mount(): Promise<void> {
  const mine = (turn += 1);
  mounted?.destroy();
  mounted = null;
  if (host.value === null) return;
  host.value.replaceChildren();
  const { language, label } = props;
  const made =
    props.text !== undefined
      ? await mountText(host.value, props.text, { language, label })
      : await mountDiff(
          host.value,
          { before: props.before ?? "", after: props.after ?? "" },
          { language, label, sideBySide: props.sideBySide },
        );
  if (mine === turn) mounted = made;
  else made.destroy();
}
const observer =
  typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver(
        (entries) => {
          if (seen || !entries.some((entry) => entry.isIntersecting)) return;
          seen = true;
          void mount();
        },
        { rootMargin: "600px 0px" },
      );
onMounted(() => {
  if (host.value === null) return;
  if (observer === null) {
    seen = true;
    void mount();
  } else observer.observe(host.value);
});
// Side effect: a text read again (a save) or the other layout mounts the editor again, once it was seen.
watch(
  () => [props.text, props.before, props.after, props.sideBySide],
  () => {
    if (seen) void mount();
  },
);
onBeforeUnmount(() => {
  observer?.disconnect();
  turn += 1;
  mounted?.destroy();
});
</script>

<template>
  <div ref="host" class="ui:min-block-5 ui:min-inline-0" />
</template>
