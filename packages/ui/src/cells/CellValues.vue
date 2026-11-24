<!-- CellValues: the values view under a cell's outputs, while meta.showBindings: the names this cell defines, refreshed from cell.bindings after each run, as a grid (name, kind, value, defined by) or as one tree of the values in the output viewer; a class instance that cannot reach the page says "not transferable". -->
<script setup lang="ts">
import type { BindingValue } from "@jsnb/core";
import { ArrowRightLeft, ListTree, Table, X } from "@lucide/vue";
import { OutputView } from "@jsnb/output-view";
import { computed, ref } from "vue";

import IconButton from "../primitives/icon-button/IconButton.vue";
import Segmented from "../primitives/segmented/Segmented.vue";
import SegmentedItem from "../primitives/segmented/SegmentedItem.vue";

const props = defineProps<{
  /** null while the first answer is on its way. */
  bindings: readonly BindingValue[] | null;
  /** "this cell" or "cell 2", for a binding's definedBy. */
  definedBy: (cell: string) => string;
  /** Only server values can be not transferable: the client page holds its own. */
  server: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

const view = ref("grid");
const tree = computed(() => ({
  kind: "value" as const,
  json: Object.fromEntries((props.bindings ?? []).map((each) => [each.name, each.json])),
  repr: "",
  truncated: false,
}));
/** A class instance (a preview such as `Stripe {…}`) is not transferable to the page as it is. */
const notTransferable = (binding: BindingValue): boolean =>
  props.server && /^[A-Z][\w$]* \{/u.test(binding.preview);
</script>

<template>
  <section
    data-part="values"
    aria-label="Values"
    class="ui:flex ui:flex-col ui:gap-2 ui:bg-result ui:ps-(--cell-inset) ui:pe-4 ui:pbs-2 ui:pbe-3"
  >
    <header class="ui:flex ui:items-center ui:gap-2 ui:text-meta ui:text-muted">
      <span class="ui:flex-1">Values</span>
      <Segmented v-model="view" label="Values view">
        <SegmentedItem value="tree"
          ><ListTree
            class="ui:block-[1cap] ui:inline-[1cap]"
            aria-hidden="true"
          />Tree</SegmentedItem
        >
        <SegmentedItem value="grid"
          ><Table class="ui:block-[1cap] ui:inline-[1cap]" aria-hidden="true" />Grid</SegmentedItem
        >
      </Segmented>
      <IconButton label="Close the values view" keys="N" @click="emit('close')"
        ><X class="ui:block-4 ui:inline-4"
      /></IconButton>
    </header>
    <p v-if="props.bindings === null" role="status" class="ui:text-small ui:text-muted">Loading…</p>
    <p v-else-if="props.bindings.length === 0" class="ui:text-small ui:text-muted">No values</p>
    <OutputView
      v-else-if="view === 'tree'"
      :output="tree"
      :options="{ view: 'tree', readonly: true, expandDepth: 1 }"
    />
    <table v-else class="ui:table-fixed ui:border-collapse ui:text-small ui:inline-full">
      <thead>
        <tr class="ui:text-start ui:text-muted">
          <th scope="col" class="ui:py-1 ui:pe-4 ui:text-start ui:font-normal">Name</th>
          <th scope="col" class="ui:py-1 ui:pe-4 ui:text-start ui:font-normal">Kind</th>
          <th scope="col" class="ui:py-1 ui:pe-4 ui:text-start ui:font-normal">Value</th>
          <th scope="col" class="ui:py-1 ui:text-start ui:font-normal">Defined by</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="binding in props.bindings" :key="binding.name">
          <td
            class="ui:py-1.5 ui:pe-4 ui:font-mono ui:text-code ui:[overflow-wrap:anywhere] ui:text-key"
          >
            {{ binding.name }}
          </td>
          <td class="ui:py-1.5 ui:pe-4 ui:text-muted">{{ binding.kind }}</td>
          <td class="ui:py-1.5 ui:pe-4">
            <span class="ui:inline-flex ui:flex-wrap ui:items-center ui:gap-2">
              <span class="ui:font-mono ui:text-code ui:[overflow-wrap:anywhere] ui:text-typ">{{
                binding.preview
              }}</span>
              <span
                v-if="notTransferable(binding)"
                class="ui:inline-flex ui:items-center ui:gap-1 ui:text-tiny ui:text-muted"
                ><ArrowRightLeft class="ui:block-[1cap] ui:inline-[1cap]" aria-hidden="true" />not
                transferable</span
              >
            </span>
          </td>
          <td class="ui:py-1.5 ui:text-muted">{{ props.definedBy(binding.definedBy) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
