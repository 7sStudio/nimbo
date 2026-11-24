<!-- CommandPalette: Cmd Shift P or F1, the top bar's command input or ui.palette.open: 35rem wide, 15 % from the top; Commands (overlays/palette.ts: what can run now, recently used first, with shortcuts; off what this tab may not write) and Cells (every cell by number, matched on its source); ↑ ↓ ↩ Esc. A command runs once the palette has closed; a cell is selected, scrolled to and focused. -->
<script setup lang="ts">
import { computed } from "vue";

import type { CellType } from "@jsnb/core";

import TypeIcon from "../cells/TypeIcon.vue";
import { typeName } from "../cells/types";
import { useDispatcher } from "../commands/dispatch";
import { isMac } from "../keyboard/modes";
import { keyWords } from "../keyboard/keymap";
import Command from "../primitives/command/Command.vue";
import CommandEmpty from "../primitives/command/CommandEmpty.vue";
import CommandGroup from "../primitives/command/CommandGroup.vue";
import CommandInput from "../primitives/command/CommandInput.vue";
import CommandItem from "../primitives/command/CommandItem.vue";
import CommandList from "../primitives/command/CommandList.vue";
import CommandShortcut from "../primitives/command/CommandShortcut.vue";
import Kbd from "../primitives/kbd/Kbd.vue";
import Dialog from "../primitives/dialog/Dialog.vue";
import DialogContent from "../primitives/dialog/DialogContent.vue";
import DialogDescription from "../primitives/dialog/DialogDescription.vue";
import DialogTitle from "../primitives/dialog/DialogTitle.vue";
import { usePageReport } from "../store/attempt";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import type { PaletteEntry } from "./palette";
import { answerLine, liveEntries, paletteCatalogue, shownEntries } from "./palette";

const dispatcher = useDispatcher();
const notebook = useNotebookStore();
const ui = useUiStore();
const report = usePageReport();
const mac = isMac(navigator.userAgent);
const catalogue = [
  ...paletteCatalogue(dispatcher.commands),
  ...liveEntries(dispatcher.entries?.() ?? []),
];
/** A registry command shows its name, as an agent calls it, where it has no shortcut (board 12). */
const registry = new Set(
  dispatcher.commands.filter((each) => each.source === "registry").map((each) => each.id),
);
/** The type chip's tints, as the gutter's (cells/CellGutter.vue). */
const chip: Readonly<Record<CellType, string>> = {
  server: "ui:bg-server-soft ui:text-server",
  client: "ui:bg-client-soft ui:text-client",
  markdown: "ui:bg-md-soft ui:text-md",
};
const entries = computed(() => shownEntries(catalogue, dispatcher.find, ui.recent));
const cells = computed(() =>
  notebook.cellsInOrder.map((cell, at) => ({
    id: cell.id,
    number: at + 1,
    type: typeName[cell.type],
    kind: cell.type,
    line: cell.source.split("\n").find((line) => line.trim() !== "") ?? "(empty)",
    source: cell.source,
  })),
);
/** Where the focus goes as the palette closes: the chosen cell, else back to where it was. */
let chosenCell: string | null = null;
const opener = document.activeElement;

function close(open: boolean): void {
  if (!open) ui.closePalette();
}
/** Runs the entry; a registry command that only reads shows what it answered in a toast, since nothing else would. */
async function run(entry: PaletteEntry): Promise<void> {
  ui.closePalette();
  ui.used(entry.command);
  const command = dispatcher.find(entry.command);
  try {
    const answer = await dispatcher.request(entry.command, entry.args);
    if (command?.source === "registry" && command.writes !== true && answer !== undefined)
      ui.toast({ kind: "info", title: entry.title, text: answerLine(answer) });
  } catch (error) {
    report(error);
  }
}
function select(cell: string): void {
  chosenCell = cell;
  ui.closePalette();
  void dispatcher.dispatch("ui.select", { cell });
}
function returnFocus(event: Event): void {
  event.preventDefault();
  const row = chosenCell === null ? null : document.querySelector(`[data-cell="${chosenCell}"]`);
  const target = row ?? (opener instanceof HTMLElement && opener.isConnected ? opener : null);
  if (target instanceof HTMLElement) {
    target.focus({ preventScroll: true });
    if (row !== null) target.scrollIntoView({ block: "nearest" });
  }
}
</script>

<template>
  <Dialog :open="true" @update:open="close">
    <DialogContent
      :show-close-button="false"
      data-testid="palette"
      data-overlay
      class="ui:inset-bs-[15vh] ui:translate-y-[0] ui:gap-0 ui:overflow-clip ui:border-border-2 ui:bg-surface ui:p-0 ui:max-inline-[min(35rem,calc(100%-2rem))]"
      @close-auto-focus="returnFocus"
    >
      <DialogTitle class="ui:visually-hidden">Command palette</DialogTitle>
      <DialogDescription class="ui:visually-hidden"
        >Search the commands and the cells; Enter runs the highlighted one.</DialogDescription
      >
      <Command class="ui:bg-surface ui:min-inline-0">
        <!-- the box is the palette's own field: the focus is always in it, so it draws no ring of its own -->
        <CommandInput
          placeholder="Go to cell, file or command"
          aria-label="Search or run a command"
          class="ui:border-0 ui:focus-visible:shadow-none"
          ><Kbd>Esc</Kbd></CommandInput
        >
        <CommandList aria-label="Commands and cells">
          <CommandEmpty>No command or cell matches.</CommandEmpty>
          <CommandGroup heading="Commands">
            <CommandItem
              v-for="entry in entries"
              :key="entry.key"
              :value="entry.key"
              :disabled="!dispatcher.available(entry.command, entry.args)"
              @select="void run(entry)"
            >
              <span class="ui:ellipsis ui:min-inline-0">{{ entry.title }}</span>
              <CommandShortcut
                v-if="entry.keys.length > 0"
                class="ui:tracking-normal ui:flex ui:shrink-0 ui:gap-1"
                ><Kbd v-for="keys in entry.keys" :key="keys">{{
                  keyWords(keys, mac)
                }}</Kbd></CommandShortcut
              >
              <CommandShortcut
                v-else-if="entry.args === undefined && registry.has(entry.command)"
                class="ui:tracking-normal"
                >{{ entry.command }}</CommandShortcut
              >
            </CommandItem>
          </CommandGroup>
          <CommandGroup v-if="cells.length > 0" heading="Cells">
            <CommandItem
              v-for="cell in cells"
              :key="cell.id"
              :value="cell.id"
              @select="select(cell.id)"
            >
              <span
                :class="[
                  'ui:inline-flex ui:shrink-0 ui:items-center ui:justify-center ui:rounded-control ui:block-5 ui:inline-5',
                  chip[cell.kind],
                ]"
                ><TypeIcon :type="cell.kind" class="ui:block-3 ui:inline-3"
              /></span>
              <span class="ui:visually-hidden">Cell {{ cell.number }}, {{ cell.type }}:</span>
              <span class="ui:ellipsis ui:font-mono ui:text-code ui:min-inline-0">{{
                cell.line
              }}</span>
              <CommandShortcut class="ui:tracking-normal ui:tabular-nums">{{
                cell.number
              }}</CommandShortcut>
              <span hidden>{{ cell.source }}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>
</template>
