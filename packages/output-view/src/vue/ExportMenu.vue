<!-- Export: JSON, NDJSON, CSV for records, TXT, the self-contained HTML page, the grid's selection
as a list, and the full value of a cut one; each saved through a Blob URL. -->
<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "reka-ui";

import type { ExportFormat, ExportOptions } from "../model/export.js";
import { exportAs, exportSelection } from "../model/export.js";
import type { ViewInput } from "../model/output.js";
import { downloadFile } from "./clipboard.js";
import { placeOf, useViewer } from "./context.js";
import IconButton from "./IconButton.vue";
import type { ExportItem } from "./menus.js";
import { fullInput, valueJson } from "./menus.js";
import { menuItem, menuPanel } from "./classes/menu.js";

const props = defineProps<{
  readonly input: ViewInput;
  readonly items: readonly ExportItem[];
  /** Streams the full value of a cut one (the host's onFetchFullValue, or a fetch of fullValueUrl), every format then
   * exporting it rather than the 256 KB slice. */
  readonly fetchFull: ((signal: AbortSignal) => Promise<Blob>) | undefined;
}>();
const viewer = useViewer();
/** The theme, and in full screen the output's value the node's refs resolve against. */
function options(input: ViewInput): ExportOptions {
  const { root } = placeOf(viewer, valueJson(input)?.json);
  const theme = viewer.theme.value;
  return theme === undefined ? { root } : { root, theme };
}

/** Saves `input` in `format`; a format it does not offer comes back as the failure's message. */
function download(input: ViewInput, format: ExportFormat): string | undefined {
  const exported = exportAs(input, format, options(input));
  if (!exported.ok) return exported.error.message;
  downloadFile(`output.${exported.value.extension}`, exported.value.text, exported.value.mime);
  return undefined;
}

async function save(entry: ExportItem): Promise<void> {
  if (entry.kind === "selection") {
    const json = valueJson(props.input)?.json;
    const exported = exportSelection(json, entry.paths, entry.format, placeOf(viewer, json).root);
    downloadFile(`selection.${exported.extension}`, exported.text, exported.mime);
    return;
  }
  const fetchFull = props.fetchFull;
  if (fetchFull === undefined) {
    const failure = download(props.input, entry.format);
    if (failure !== undefined) viewer.fail(failure);
    return;
  }
  await viewer.run(`Exporting the full value as ${entry.label}`, async (signal) => {
    const failure = download(await fullInput(props.input, await fetchFull(signal)), entry.format);
    if (failure !== undefined) throw new Error(failure);
  });
}
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <IconButton label="Export" icon="download" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        class="jsnb-ov"
        :class="menuPanel"
        data-part="menu"
        :data-theme="viewer.theme.value"
        align="end"
        :side-offset="4"
      >
        <DropdownMenuItem
          v-for="entry in items"
          :key="entry.label"
          data-part="menu-item"
          :class="menuItem"
          @select="save(entry)"
        >
          {{ entry.label }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
