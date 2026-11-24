<!-- FileTree: the workspace's notebooks as a file tree, as VS Code's Explorer and shadcn's file tree show one (Reka's Tree): folders fold and unfold (all folded at first), each level indented with a hairline guide (a repeating gradient, as shadcn's and reui's trees), folders with folder and folder-open icons and notebooks with a notebook icon; Up and Down move, Right and Left unfold and fold, typing jumps to a name. A click selects (and folds or unfolds a folder), a double click or Enter on a notebook opens it, F2 renames and Delete deletes where the page offers it. An open notebook has a dot, a running one a spinner. The row being renamed shows the rename slot in place of its name. -->
<script setup lang="ts">
import { ChevronRight, Folder, FolderOpen, LoaderCircle, NotebookText } from "@lucide/vue";
import { TreeItem, TreeRoot } from "reka-ui";
import { computed } from "vue";

import type { TreeNode } from "../store/homeTree";

const props = defineProps<{
  nodes: readonly TreeNode[];
  /** The selected node's key, or null. */
  selected: string | null;
  /** The notebook whose page this is (its row is the current one). */
  current?: string;
  /** Open notebooks by ref: "busy" while one runs. */
  states?: Readonly<Record<string, "open" | "busy">>;
  /** The notebook whose name is being edited: the rename slot shows in its row. */
  renaming?: string | null;
  label: string;
}>();
const expanded = defineModel<string[]>("expanded", { required: true });
const emit = defineEmits<{
  select: [node: TreeNode];
  open: [node: TreeNode];
  rename: [node: TreeNode];
  remove: [node: TreeNode];
}>();
defineSlots<{ rename?: (props: { node: TreeNode }) => unknown }>();

const byKey = computed(() => {
  const map = new Map<string, TreeNode>();
  const walk = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      map.set(node.key, node);
      walk(node.children ?? []);
    }
  };
  walk(props.nodes);
  return map;
});
const model = computed(() =>
  props.selected === null ? undefined : byKey.value.get(props.selected),
);
/** Reka's Tree takes mutable arrays: copies of the read-only nodes. */
const items = computed<TreeNode[]>(() => [...props.nodes]);
const childrenOf = (node: TreeNode): TreeNode[] | undefined =>
  node.folder ? [...(node.children ?? [])] : undefined;
const step = 0.875;
const indent = (level: number) => ({
  paddingInlineStart: `${String(0.25 + (level - 1) * step)}rem`,
});
/** One hairline per level above the row, at each level's chevron, in the border colour: a repeating gradient across the
 * indent, as shadcn's and reui's trees draw their guides. */
const guides = (level: number) => ({
  insetInlineStart: `${String(0.25 + 0.4375)}rem`,
  inlineSize: `${String((level - 1) * step)}rem`,
  backgroundImage: `repeating-linear-gradient(to right, var(--border) 0 0.0625rem, transparent 0.0625rem ${String(step)}rem)`,
});

/** Enter on a notebook opens it, F2 renames, Delete or Backspace deletes; the tree keeps its other keys. */
function keyed(event: KeyboardEvent, node: TreeNode): void {
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" && !node.folder) emit("open", node);
  else if (event.key === "F2" && !node.folder) emit("rename", node);
  else if ((event.key === "Delete" || event.key === "Backspace") && !node.folder)
    emit("remove", node);
  else return;
  event.preventDefault();
}
</script>

<template>
  <TreeRoot
    v-slot="{ flattenItems }"
    v-model:expanded="expanded"
    :items="items"
    :get-key="(node: TreeNode) => node.key"
    :get-children="childrenOf"
    :model-value="model"
    :aria-label="props.label"
    data-keys="own"
    class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0"
  >
    <TreeItem
      v-for="item in flattenItems"
      v-slot="{ isExpanded }"
      :key="item._id"
      v-bind="item.bind"
      :data-key="item.value.key"
      :data-path="item.value.path"
      :data-folder="item.value.folder ? '' : undefined"
      :aria-current="item.value.path === props.current ? 'page' : undefined"
      :style="indent(item.level)"
      class="ui:relative ui:flex ui:cursor-pointer ui:items-center ui:gap-1 ui:rounded-small ui:pe-2 ui:text-fg-2 ui:select-none ui:block-[1.375rem] ui:hover:bg-well ui:focus-visible:shadow-[inset_0_0_0_2px_var(--guide-on)] ui:aria-[current=page]:font-semibold ui:aria-[current=page]:text-fg ui:data-[selected]:bg-head-focus ui:data-[selected]:text-fg"
      @select="(event) => (event.preventDefault(), emit('select', item.value))"
      @dblclick="item.value.folder ? undefined : emit('open', item.value)"
      @keydown="keyed($event, item.value)"
    >
      <span
        v-if="item.level > 1"
        aria-hidden="true"
        data-part="guide"
        :style="guides(item.level)"
        class="ui:pointer-events-none ui:absolute ui:inset-bs-0 ui:inset-be-0"
      />
      <ChevronRight
        v-if="item.value.folder"
        :class="[
          'ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5 ui:motion-safe:transition-transform',
          isExpanded ? 'ui:rotate-90' : '',
        ]"
        aria-hidden="true"
      />
      <span v-else aria-hidden="true" class="ui:shrink-0 ui:inline-3.5" />
      <component
        :is="item.value.folder ? (isExpanded ? FolderOpen : Folder) : NotebookText"
        :class="[
          'ui:shrink-0 ui:block-3.5 ui:inline-3.5',
          item.value.folder ? 'ui:text-fg-2' : 'ui:text-fill',
        ]"
        aria-hidden="true"
      />
      <slot
        v-if="props.renaming === item.value.path && !item.value.folder"
        name="rename"
        :node="item.value"
      />
      <span v-else class="ui:flex-1 ui:ellipsis ui:min-inline-0" :title="item.value.path">{{
        item.value.name
      }}</span>
      <LoaderCircle
        v-if="props.states?.[item.value.path] === 'busy'"
        class="ui:shrink-0 ui:text-hot ui:block-3 ui:inline-3 ui:motion-safe:animate-spin"
        aria-label="running"
      />
      <span
        v-else-if="props.states?.[item.value.path] === 'open'"
        role="img"
        aria-label="open"
        class="ui:shrink-0 ui:rounded-[1em] ui:bg-ok ui:block-1.5 ui:inline-1.5"
      />
    </TreeItem>
  </TreeRoot>
</template>
