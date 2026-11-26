<!-- ShippedGroup: one group of finished notebooks to start from, lighter than the lessons: its heading, then each notebook's title and what it is for; a click opens a copy in the workspace (ui.home.example). Home lists the examples shipped with the app this way, and any other group beside them. The list is one tab stop, Up, Down, Home and End move along it. -->
<script setup lang="ts">
import { NotebookText } from "@lucide/vue";
import { ref } from "vue";

const props = defineProps<{
  id: string;
  title: string;
  items: readonly { readonly name: string; readonly title: string; readonly purpose: string }[];
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const current = ref(0);
const list = ref<HTMLElement | null>(null);
function move(event: KeyboardEvent): void {
  const last = props.items.length - 1;
  const to = {
    ArrowDown: Math.min(current.value + 1, last),
    ArrowUp: Math.max(current.value - 1, 0),
    Home: 0,
    End: last,
  }[event.key];
  if (to === undefined) return;
  event.preventDefault();
  current.value = to;
  list.value?.querySelectorAll<HTMLElement>("button")[to]?.focus();
}
</script>

<template>
  <section :aria-labelledby="`${props.id}-title`" :data-testid="props.id">
    <h2
      :id="`${props.id}-title`"
      class="ui:tracking-wide ui:m-0 ui:mbe-1.5 ui:flex ui:items-center ui:ps-3 ui:text-tiny ui:font-semibold ui:text-fg-2 ui:uppercase ui:block-7"
    >
      {{ props.title }}
    </h2>
    <ul ref="list" class="ui:m-0 ui:list-none ui:p-0" @keydown="move">
      <li v-for="(each, at) in props.items" :key="each.name">
        <button
          type="button"
          :data-example="each.name"
          :tabindex="at === current ? 0 : -1"
          :aria-describedby="`${props.id}-purpose-${String(at)}`"
          class="ui:grid ui:cursor-pointer ui:grid-cols-[0.875rem_minmax(0,1fr)] ui:items-start ui:gap-x-2.5 ui:border-0 ui:bg-transparent ui:px-3 ui:py-1.5 ui:text-start ui:font-inherit ui:inline-full ui:hover:bg-head ui:focus-visible:shadow-[inset_0_0_0_2px_var(--guide-on)] ui:motion-safe:transition-colors"
          @click="emit('command', 'ui.home.example', { name: each.name })"
          @focus="current = at"
        >
          <NotebookText class="ui:text-faint ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          <span class="ui:flex ui:flex-col ui:gap-0.5 ui:min-inline-0">
            <span class="ui:text-name ui:leading-tight ui:text-fg">{{ each.title }}</span>
            <span
              :id="`${props.id}-purpose-${String(at)}`"
              aria-hidden="true"
              class="ui:text-tiny ui:leading-ui ui:text-pretty ui:text-muted"
              >{{ each.purpose }}</span
            >
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>
