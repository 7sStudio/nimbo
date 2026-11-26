<!-- Full screen (⌘⇧O): the same viewer in a Reka dialog. The breadcrumb of the
path sits on top (a container row goes down, a crumb goes back), with copy path, "open in a new tab" and close; the
nested OutputView in the default slot brings the view switch, find with its scope, the query bar, copy and export. -->
<script setup lang="ts">
import type { Path } from "@jsnb/core";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { computed, provide, ref } from "vue";

import type { ViewInput } from "../model/output.js";
import { formatPath } from "../model/path.js";
import { countLabel, typeLabel } from "../model/preview.js";
import { kindOf, resolve } from "../model/wire.js";
import { useViewer } from "./context.js";
import { drillKey } from "./fullscreen.js";
import IconButton from "./IconButton.vue";
import { useTrailEnd } from "./useTrailEnd.js";

const props = defineProps<{
  readonly summary: string;
  /** The output's own value was cut, and where its full value is: both hold at the root of that value only. */
  readonly truncated: boolean;
  readonly fullValueUrl: string | undefined;
}>();
const open = defineModel<boolean>("open", { required: true });
const json = defineModel<unknown>("json", { required: true });
const path = defineModel<Path>("path", { default: () => [] });
const emit = defineEmits<{ "open-in-tab": [path: string] }>();
defineSlots<{
  default: (scope: { output: ViewInput; fullValueUrl: string | undefined }) => unknown;
}>();
const viewer = useViewer();
const node = computed(() => resolve(json.value, path.value)?.node);
provide(drillKey, {
  down: (rel) => {
    path.value = [...path.value, ...rel];
  },
  open: (next, at) => {
    json.value = next;
    path.value = at;
  },
  place: computed(() => ({ root: json.value, base: path.value, json: node.value })),
});
const top = computed(() => path.value.length === 0);
/** The nested viewer's input, kept while the node is the same so its tree and find stay as they are. */
const output = computed((): ViewInput => ({
  kind: "value",
  json: node.value,
  repr: "",
  truncated: props.truncated && top.value,
}));
const nested = computed(() => ({
  output: output.value,
  fullValueUrl: top.value ? props.fullValueUrl : undefined,
}));
const crumbs = computed(() =>
  path.value.map((segment, index) => ({
    label: typeof segment === "number" ? `[${String(segment)}]` : segment,
    path: path.value.slice(0, index + 1),
  })),
);
const trail = ref<HTMLElement | null>(null);
useTrailEnd(trail, path);
const here = computed(() => {
  const kind = kindOf(node.value);
  return countLabel(node.value, kind) ?? typeLabel(node.value, kind) ?? kind;
});
/** A crumb: a word of the path in the secondary color, followed by › unless it is the last. */
const crumbClass =
  "ov:flex-none ov:cursor-pointer ov:border-0 ov:bg-transparent ov:px-1 ov:py-0 ov:font-inherit ov:whitespace-nowrap ov:text-fg-2 ov:not-last:after:text-fg-2 ov:not-last:after:content-['_›']";
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay
        class="jsnb-ov ov:fixed ov:inset-x-0 ov:inset-y-0 ov:z-(--z-panel) ov:bg-scrim"
        data-part="overlay"
        :data-theme="viewer.theme.value"
      />
      <!-- the nested viewer fills the dialog between the head and the foot, and its views scroll inside (--fit-height
      lifts the fit cap there) -->
      <DialogContent
        class="jsnb-ov ov:fixed ov:inset-x-[4vw] ov:inset-y-[4vh] ov:z-(--z-panel) ov:flex ov:flex-col ov:overflow-clip ov:rounded-panel ov:border ov:border-border ov:[--fit-height:none]"
        data-part="dialog"
        :data-theme="viewer.theme.value"
      >
        <!-- one row whatever the window: the crumbs scroll inside it and the buttons keep their place -->
        <header
          data-part="dialog-head"
          class="ov:flex ov:items-center ov:gap-2 ov:border-be ov:border-border ov:px-3 ov:py-2"
        >
          <DialogTitle
            data-part="dialog-title"
            class="ov:m-0 ov:flex-none ov:text-title ov:font-semibold"
            >Output</DialogTitle
          >
          <!-- a path longer than the head scrolls on purpose, shown from its end (useTrailEnd); each crumb keeps its › -->
          <nav
            ref="trail"
            data-part="crumbs"
            class="ov:flex ov:min-inline-0 ov:flex-[1_1_0] ov:gap-0.5 ov:overflow-x-auto ov:font-mono ov:text-small ov:[scrollbar-width:thin]"
            aria-label="Path"
          >
            <button type="button" data-part="crumb" :class="crumbClass" @click="path = []">
              $
            </button>
            <button
              v-for="crumb in crumbs"
              :key="formatPath(crumb.path)"
              type="button"
              data-part="crumb"
              :class="crumbClass"
              @click="path = crumb.path"
            >
              {{ crumb.label }}
            </button>
          </nav>
          <IconButton
            label="Copy path"
            icon="link"
            @click="viewer.copy('path', formatPath(path))"
          />
          <IconButton
            label="Open in a new tab"
            icon="external"
            @click="emit('open-in-tab', formatPath(path))"
          />
          <DialogClose as-child
            ><IconButton label="Close" icon="close" shortcut="Esc"
          /></DialogClose>
        </header>
        <slot v-bind="nested" />
        <DialogDescription
          data-part="dialog-foot"
          class="ov:m-0 ov:border-bs ov:border-border ov:px-3 ov:py-1.5 ov:text-small ov:text-fg-2"
          >{{ here }} at this path, {{ summary }}</DialogDescription
        >
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
