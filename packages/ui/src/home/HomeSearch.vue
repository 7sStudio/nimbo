<!-- HomeSearch: Home's search field, where the cursor starts: what is typed finds notebooks by file name, title, route or export; Up and Down move the selection, Enter opens the selected notebook (creates the typed name after N or when nothing matches), Cmd Enter creates one named as typed (in the folder picked), F2 renames the selected one, Esc clears (Home's ui.escape). It is the list's combobox: the selected row is its active option. After N or New Notebook its placeholder asks for the new name. -->
<script setup lang="ts">
import { Search } from "@lucide/vue";
import { nextTick, onMounted, ref, watch } from "vue";

import { useHomeStore } from "../store/home";

const props = defineProps<{
  mac: boolean;
  /** The id of the selected row, the field's active option. */
  active: string | undefined;
  /** No list to control: the empty workspace. */
  empty: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const home = useHomeStore();
const field = ref<HTMLInputElement | null>(null);
/** Enter's command from the field: the create row's when a name is typed after N or nothing matches (the one option
 * then), else opening the selected notebook. */
function enterCommand(typed: string): [string, Record<string, unknown>?] | undefined {
  if (typed !== "" && (home.naming || home.selected === null))
    return ["ui.notebook.new", { name: typed }];
  return home.selected === null ? undefined : ["ui.notebook.open"];
}
/** The command a key runs from the field, with its arguments; undefined for a key the field keeps. */
function commandOf(event: KeyboardEvent): [string, Record<string, unknown>?] | undefined {
  const typed = home.query.trim();
  if (event.key === "ArrowDown") return ["ui.home.select.next"];
  if (event.key === "ArrowUp") return ["ui.home.select.previous"];
  if (event.key === "Enter" && (props.mac ? event.metaKey : event.ctrlKey))
    return typed === "" ? ["ui.notebook.new"] : ["ui.notebook.new", { name: typed }];
  if (event.key === "Enter") return enterCommand(typed);
  return event.key === "F2" && home.selected !== null ? ["ui.notebook.rename"] : undefined;
}
function keyed(event: KeyboardEvent): void {
  const command = commandOf(event);
  if (command === undefined) return;
  event.preventDefault();
  emit("command", ...command);
}
// Side effect: N, New notebook and the end of a rename give the field the focus, its text selected.
watch(
  () => home.searchFocus,
  async () => {
    await nextTick();
    field.value?.focus();
    field.value?.select();
  },
);
// Side effect: a name erased back to nothing ends the naming, so what is typed next searches again.
watch(
  () => home.query,
  (query, before) => {
    if (query === "" && before !== "") home.naming = false;
  },
);
onMounted(() => {
  field.value?.focus();
});
</script>

<template>
  <label
    class="ui:group ui:flex ui:items-center ui:gap-2 ui:rounded-control ui:border ui:border-border ui:bg-sheet ui:px-2.5 ui:block-8 ui:inline-[min(36rem,100%)] ui:has-[:focus-visible]:border-accent"
  >
    <Search class="ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
    <input
      ref="field"
      v-model="home.query"
      data-testid="search"
      role="combobox"
      aria-label="Search notebooks, or name a new one"
      aria-autocomplete="list"
      :aria-controls="props.empty ? undefined : 'home-list'"
      :aria-expanded="!props.empty"
      :aria-activedescendant="props.active"
      :placeholder="home.naming ? 'New notebook name' : 'Search notebooks'"
      autocomplete="off"
      spellcheck="false"
      class="ui:flex-1 ui:border-0 ui:bg-transparent ui:p-0 ui:font-inherit ui:text-ui ui:text-fg ui:min-inline-0 ui:placeholder:text-faint ui:focus-visible:shadow-none"
      @keydown="keyed"
    />
  </label>
</template>
