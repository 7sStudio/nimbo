<!-- A primitive or bytes value (gallery cards 4 and 6): its tokens with hints, a URL as a link, "View as tree" for a
JSON string, a long string folded behind "Show all", and "Copy base64" for bytes. Its end keeps room for the toolbar
where it floats over a bare primitive (OutputToolbar.vue, data-bare). -->
<script setup lang="ts">
import { computed, ref } from "vue";

import { hintsFor, parseJsonText } from "../model/hints.js";
import { leafTokens } from "../model/leaf.js";
import { plural } from "../model/preview.js";
import { kindOf, textField } from "../model/wire.js";
import { useViewer } from "./context.js";
import HintList from "./HintList.vue";
import { foldOf, leafOptions, linkOf } from "./rowView.js";
import TokenText from "./TokenText.vue";
import TextButton from "./TextButton.vue";
import { link } from "./classes/link.js";

const props = defineProps<{ readonly json: unknown }>();
const viewer = useViewer();
const unfolded = ref(false);
const kind = computed(() => kindOf(props.json));
const hints = computed(() => hintsFor(props.json, viewer.hints.value));
const tokens = computed(() =>
  leafTokens(props.json, kind.value, leafOptions(viewer.hints.value.timeZone, [])),
);
const href = computed(() => linkOf(hints.value));
const fold = computed(() => (unfolded.value ? undefined : foldOf(props.json, hints.value)));
const base64 = computed(() =>
  kind.value === "bytes" ? textField(props.json, "base64") : undefined,
);

function viewTree(): void {
  const parsed = typeof props.json === "string" ? parseJsonText(props.json) : undefined;
  if (parsed) viewer.openFullscreen(parsed.json, []);
}
</script>

<template>
  <div
    data-part="primitive"
    class="ov:flex ov:flex-wrap ov:items-baseline ov:gap-2 ov:px-2 ov:py-1 ov:group-has-[[data-bare]]/output:pe-28 ov:font-mono ov:text-value ov:leading-code ov:wrap-anywhere"
  >
    <a
      v-if="href"
      :href="href"
      target="_blank"
      rel="noopener noreferrer"
      data-part="link"
      :class="link"
      ><TokenText :tokens="tokens"
    /></a>
    <template v-else-if="fold">
      <TokenText :tokens="[{ kind: 'str', text: `${JSON.stringify(fold.shown).slice(0, -1)}…` }]" />
      <TextButton part="hint-action" @click="unfolded = true">
        Show {{ plural(fold.hidden, "more character", "more characters") }}
      </TextButton>
    </template>
    <TokenText v-else :tokens="tokens" />
    <HintList v-if="hints.length > 0" :hints="hints" @view-tree="viewTree" />
    <TextButton
      v-if="base64 !== undefined"
      part="hint-action"
      @click="viewer.copy('base64', base64)"
    >
      Copy base64
    </TextButton>
  </div>
</template>
