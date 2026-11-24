<!-- SettingsItem: one setting of the Settings editor, as VS Code draws one: "Group: Title" with the title bold, the description under it, then the control the schema asks for (a checkbox beside the description for a boolean, a select, a number or text field); a bar at its start while the file of the chosen scope sets it, "Modified in: Workspace" (or "Also modified in" when this tab's file sets it too) when the other file sets it, a link to that tab, and a gear in the gutter at its start (on hover or focus) with Reset Setting, Copy Setting ID and Copy Setting as JSON. A field writes on change; a typed value the schema refuses is said under it and not written, and a write that failed puts the value shown back. -->
<script setup lang="ts">
import { Settings2 } from "@lucide/vue";
import { DropdownMenuTrigger } from "reka-ui";
import { computed, ref, watch } from "vue";

import DropdownMenu from "../primitives/dropdown-menu/DropdownMenu.vue";
import DropdownMenuContent from "../primitives/dropdown-menu/DropdownMenuContent.vue";
import DropdownMenuItem from "../primitives/dropdown-menu/DropdownMenuItem.vue";
import DropdownMenuSeparator from "../primitives/dropdown-menu/DropdownMenuSeparator.vue";
import TextInput from "../primitives/text-input/TextInput.vue";
import { copyText } from "../store/clipboard";
import { useUiStore } from "../store/ui";
import type { Scope } from "../store/settings";
import { useSettingsStore } from "../store/settings";
import type { Field } from "./settingsFields";
import { itemTitle, modifiedElsewhere, parsed, shownValue } from "./settingsFields";

const props = defineProps<{ group: string; field: Field; scope: Scope; off: boolean }>();
const emit = defineEmits<{ scope: [scope: Scope] }>();

const settings = useSettingsStore();
const ui = useUiStore();
const key = computed(() => props.field.key);
const entry = computed(() => settings.values[props.field.key]);
/** What this tab's file sets, else the default (VS Code's User and Workspace tabs). */
const here = computed(() => shownValue(entry.value, props.scope, props.field.fallback));
const value = computed(() => here.value.value);
/** The chosen file sets this key: the bar at its start, and Reset Setting has something to remove. */
const modified = computed(() => here.value.set);
/** The other file sets it too: "Modified in: Workspace", a link to that tab. */
const elsewhere = computed(() => modifiedElsewhere(entry.value, props.scope));
const id = computed(() => `setting-${props.field.key.replace(/\./gu, "-")}`);

const shown = (raw: unknown): string =>
  typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? String(raw) : "";
const typed = ref(shown(value.value));
const error = ref<string | null>(null);
/** The text last written, so Enter then the change on leaving the field write once. */
let sent: string | null = null;
// a value that changed elsewhere (another tab, the CLI, the JSON view) replaces what the field shows
watch(value, (now) => {
  typed.value = shown(now);
  error.value = null;
  sent = null;
});
/** Copy Setting as JSON: the line this tab's file would hold, `"editor.fontSize": 13`. */
const asJson = computed(() => `"${props.field.key}": ${JSON.stringify(value.value ?? null)}`);
const write = (next: unknown) => settings.set(key.value, next, props.scope);
function restore(target: EventTarget | null): void {
  typed.value = shown(value.value);
  sent = null;
  if (target instanceof HTMLSelectElement) target.value = shown(value.value);
  else if (target instanceof HTMLInputElement && target.type === "checkbox")
    target.checked = value.value === true;
}
async function commit(): Promise<void> {
  const text = typed.value;
  if ((modified.value && text === shown(value.value)) || text === sent) return;
  const result = parsed(props.field.control, text);
  error.value = "error" in result ? result.error : null;
  if (!("value" in result)) return;
  sent = text;
  // a write the daemon refused shows the file's value again
  if ((await write(result.value)) === undefined) restore(null);
}
async function choose(event: Event): Promise<void> {
  const target = event.target;
  const next =
    target instanceof HTMLSelectElement
      ? target.value
      : target instanceof HTMLInputElement && target.checked;
  if ((await write(next)) === undefined) restore(target);
}
const control =
  "ui:rounded-control ui:border ui:border-border ui:bg-bg ui:px-2 ui:font-inherit ui:text-small ui:text-fg ui:block-7 ui:focus-visible:border-accent ui:disabled:opacity-45";
</script>

<template>
  <div
    :data-setting="props.field.key"
    :data-modified="modified ? '' : undefined"
    class="ui:group/item ui:relative ui:flex ui:flex-col ui:gap-1 ui:rounded-small ui:py-2.5 ui:ps-4 ui:pe-2 ui:hover:bg-surface ui:has-[:focus-visible]:bg-surface"
  >
    <span
      v-if="modified"
      aria-hidden="true"
      class="ui:absolute ui:inset-s-0 ui:inset-bs-3 ui:inset-be-3 ui:rounded-pill ui:bg-fill ui:inline-0.5"
    />
    <div class="ui:flex ui:items-center ui:gap-2 ui:min-block-6">
      <label :for="id" class="ui:text-ui ui:text-fg">
        <span class="ui:text-fg-2">{{ props.group }}: </span
        ><span class="ui:font-semibold">{{ itemTitle(props.group, props.field.title) }}</span>
      </label>
      <span
        v-if="elsewhere !== null"
        data-testid="setting-elsewhere"
        class="ui:text-tiny ui:text-muted"
        >({{ modified ? "Also modified in" : "Modified in" }}:
        <button
          type="button"
          class="ui:cursor-pointer ui:border-0 ui:bg-transparent ui:p-0 ui:font-inherit ui:text-accent-text ui:hover:underline"
          @click="emit('scope', elsewhere)"
        >
          {{ elsewhere === "user" ? "User" : "Workspace" }}</button
        >)</span
      >
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            :aria-label="`More actions for ${props.field.key}`"
            data-testid="setting-gear"
            class="ui:absolute ui:inset-s-[-1.75rem] ui:inset-bs-2.5 ui:inline-flex ui:cursor-pointer ui:items-center ui:justify-center ui:rounded-small ui:border ui:border-transparent ui:bg-transparent ui:p-0 ui:text-muted ui:opacity-0 ui:block-6 ui:inline-6 ui:group-hover/item:opacity-100 ui:group-has-[:focus-visible]/item:opacity-100 ui:hover:bg-well ui:hover:text-fg ui:focus-visible:border-accent ui:data-[state=open]:opacity-100"
          >
            <Settings2 class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent data-overlay="menu" align="start" class="ui:min-inline-[12rem]">
          <DropdownMenuItem
            :disabled="!modified || props.off"
            @select="settings.reset(key, props.scope)"
            >Reset Setting</DropdownMenuItem
          >
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="copyText(ui, props.field.key, 'the setting ID')"
            >Copy Setting ID</DropdownMenuItem
          >
          <DropdownMenuItem @select="copyText(ui, asJson, 'the setting as JSON')"
            >Copy Setting as JSON</DropdownMenuItem
          >
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <label
      v-if="props.field.control.kind === 'switch'"
      :for="id"
      class="ui:flex ui:cursor-pointer ui:items-start ui:gap-2 ui:text-small ui:text-fg-2"
    >
      <input
        :id="id"
        type="checkbox"
        :checked="value === true"
        :disabled="props.off"
        class="ui:m-0 ui:mbs-0.5 ui:shrink-0 ui:cursor-pointer ui:accent-fg ui:block-3.5 ui:inline-3.5 ui:disabled:cursor-default"
        @change="choose"
      />
      <span>{{ props.field.description }}</span>
    </label>
    <template v-else>
      <p :id="`${id}-about`" class="ui:m-0 ui:text-small ui:text-fg-2">
        {{ props.field.description }}
      </p>
      <select
        v-if="props.field.control.kind === 'select'"
        :id="id"
        :value="shown(value)"
        :disabled="props.off"
        :aria-describedby="`${id}-about`"
        :class="[control, 'ui:mbs-1 ui:inline-fit ui:min-inline-[10rem]']"
        @change="choose"
      >
        <option v-for="option in props.field.control.options" :key="option" :value="option">
          {{ option }}
        </option>
      </select>
      <TextInput
        v-else
        :id="id"
        :model-value="typed"
        :type="props.field.control.kind === 'number' ? 'number' : 'text'"
        :min="props.field.control.kind === 'number' ? props.field.control.min : undefined"
        :placeholder="
          props.field.control.kind === 'text' && props.field.control.nullable
            ? 'not set'
            : undefined
        "
        :disabled="props.off"
        :aria-invalid="error !== null"
        :aria-describedby="`${id}-about`"
        class="ui:mbs-1 ui:border ui:border-border ui:max-inline-[24rem]"
        @update:model-value="(next: unknown) => (typed = String(next))"
        @change="commit"
        @keydown.enter="commit"
      />
    </template>
    <p v-if="error !== null" class="ui:m-0 ui:text-small ui:text-err-text" role="alert">
      {{ error }}
    </p>
  </div>
</template>
