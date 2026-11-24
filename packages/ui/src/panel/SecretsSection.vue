<!-- SecretsSection: the secret names of the workspace's .env, never their values. Each row says which cells read it through env (or "unused") and has Edit, shown while the row is hovered or holds the keyboard's focus, which opens the form with the name filled to replace its value; Add opens the form empty. The value field is a password field, never echoed and cleared once saved; a saved value is hidden and never sent to the page. secrets.list on open, since an agent may have set one. -->
<script setup lang="ts">
import { secretNamePattern } from "@jsnb/core";
import { Plus } from "@lucide/vue";
import { computed, nextTick, ref } from "vue";

import { runsOff } from "../app/useShell";
import { useDispatcher } from "../commands/dispatch";
import Button from "../primitives/button/Button.vue";
import Kbd from "../primitives/kbd/Kbd.vue";
import TextInput from "../primitives/text-input/TextInput.vue";
import { useNotebookStore } from "../store/notebook";
import { useWorkspaceStore } from "../store/workspace";
import Section from "./Section.vue";
import { rowAction, rowEnd, wordButton } from "./rows";
import { readersOf } from "./secretUses";
import { whenStarted } from "./whenStarted";

const dispatcher = useDispatcher();
const workspace = useWorkspaceStore();
const notebook = useNotebookStore();
const uses = (name: string) => {
  const cells = readersOf(notebook.cellsInOrder, name);
  if (cells.length === 0) return "unused";
  return `${cells.length === 1 ? "cell" : "cells"} ${cells.join(", ")}`;
};

const form = ref(false);
/** The secret whose value the form replaces, or null when it adds one. */
const editing = ref<string | null>(null);
const name = ref("");
const value = ref("");
const valid = computed(() => secretNamePattern.test(name.value));
async function show(preset: string | null = null): Promise<void> {
  form.value = true;
  editing.value = preset;
  name.value = preset ?? "";
  value.value = "";
  await nextTick();
  document.getElementById(preset === null ? "secret-name" : "secret-value")?.focus();
}
/** Nothing writes in a view-only or closed tab. */
const off = computed(() => runsOff(notebook));
/** Sets the secret; the form closes, and the value is forgotten, once the write went through; a refused one keeps
 * both fields to correct. */
async function submit(): Promise<void> {
  if (!valid.value || value.value === "") return;
  const done = await dispatcher.request("ui.secrets.set", { name: name.value, value: value.value });
  if (done !== undefined) close();
}
function close(): void {
  form.value = false;
  value.value = "";
}
whenStarted(notebook, workspace.refreshSecrets);
</script>

<template>
  <Section name="secrets" title="Secrets" :count="workspace.secrets.length" :force-open="form">
    <template #tools>
      <button
        type="button"
        aria-label="Add secret"
        :class="[wordButton, 'ui:bg-sheet']"
        :disabled="off"
        @click="show()"
      >
        <Plus class="ui:block-3 ui:inline-3" aria-hidden="true" />Add
      </button>
    </template>
    <ul
      v-if="workspace.secrets.length > 0"
      aria-label="Secrets"
      class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0"
    >
      <li
        v-for="secret in workspace.secrets"
        :key="secret"
        class="ui:group/row ui:flex ui:items-center ui:gap-2 ui:rounded-control ui:ps-1.75 ui:pe-1 ui:block-6.5 ui:min-inline-0 ui:hover:bg-sheet ui:has-[:focus-visible]:bg-sheet"
      >
        <span class="ui:ellipsis ui:font-mono ui:text-[0.71875rem] ui:text-fg ui:min-inline-0">{{
          secret
        }}</span>
        <span :class="rowEnd" data-part="uses">{{ uses(secret) }}</span>
        <button
          type="button"
          :aria-label="`Edit ${secret}`"
          :class="[wordButton, rowAction]"
          :disabled="off"
          @click="show(secret)"
        >
          Edit
        </button>
      </li>
    </ul>
    <form
      v-if="form"
      aria-label="Set a secret"
      class="ui:mbs-1.5 ui:flex ui:flex-col ui:gap-1.25 ui:bg-head ui:px-1.75 ui:pbs-1.75 ui:pbe-2"
      @submit.prevent="submit"
      @keydown.esc.stop="close"
    >
      <p class="ui:m-0 ui:font-semibold">
        {{ editing === null ? "New secret" : `New value for ${editing}` }}
      </p>
      <label class="ui:flex ui:flex-col ui:gap-0.5 ui:text-tiny ui:text-muted">
        Name
        <TextInput
          id="secret-name"
          v-model="name"
          placeholder="STRIPE_SECRET_KEY"
          class="ui:font-mono"
          autocomplete="off"
          spellcheck="false"
          :aria-invalid="name !== '' && !valid"
        />
      </label>
      <p v-if="name !== '' && !valid" class="ui:m-0 ui:text-tiny ui:text-err">
        A-Z, 0-9 and _, starting with a letter
      </p>
      <label class="ui:flex ui:flex-col ui:gap-0.5 ui:text-tiny ui:text-muted">
        Value
        <TextInput
          id="secret-value"
          v-model="value"
          type="password"
          class="ui:font-mono"
          autocomplete="new-password"
          spellcheck="false"
        />
      </label>
      <div class="ui:mbs-0.5 ui:flex ui:items-center ui:gap-1.5">
        <Button type="submit" variant="primary" size="sm" :disabled="!valid || value === '' || off"
          >Save<Kbd class="ui:text-current ui:opacity-75">Enter</Kbd></Button
        >
        <Button type="button" size="sm" @click="close">Cancel<Kbd>Esc</Kbd></Button>
      </div>
    </form>
  </Section>
</template>
