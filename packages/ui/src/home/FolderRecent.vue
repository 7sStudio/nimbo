<!-- FolderRecent: the folder picker's recent folders (workspace.recentFolders, the ones still there): each by its last two folders, the full path in its tooltip, the one open here said so; a click lists it in the picker. -->
<script setup lang="ts">
import { History } from "@lucide/vue";

import { shortPath, type RecentFolder } from "../store/homeFolders";

const props = defineProps<{ folders: readonly RecentFolder[] }>();
const emit = defineEmits<{ go: [path: string] }>();
const rowClass =
  "ui:flex ui:cursor-pointer ui:items-center ui:gap-2 ui:px-2 ui:text-ui ui:text-fg-2 ui:block-7 ui:min-inline-0 ui:hover:bg-sheet";
</script>

<template>
  <section aria-labelledby="recent-title" class="ui:flex ui:flex-col ui:gap-1 ui:min-inline-0">
    <h3
      id="recent-title"
      class="ui:m-0 ui:flex ui:items-center ui:gap-1.5 ui:text-ui ui:font-semibold ui:text-fg ui:block-6"
    >
      <History class="ui:text-muted ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
      Recent folders
    </h3>
    <ul
      v-if="props.folders.length > 0"
      aria-label="Recent folders"
      data-testid="recent-folders"
      class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0"
    >
      <li v-for="folder in props.folders" :key="folder.path">
        <button
          type="button"
          :title="folder.path"
          :class="[
            rowClass,
            'ui:border ui:border-transparent ui:bg-transparent ui:text-start ui:inline-full ui:focus-visible:border-accent',
          ]"
          @click="emit('go', folder.path)"
        >
          <!-- cut from the left when it does not fit, so the end that tells two folders apart stays in view -->
          <span dir="rtl" class="ui:flex-1 ui:ellipsis ui:text-end ui:min-inline-0"
            ><bdi dir="ltr">{{
              shortPath(
                folder.path,
                props.folders.map((each) => each.path),
              )
            }}</bdi></span
          >
          <span v-if="folder.current" class="ui:shrink-0 ui:text-tiny ui:text-muted"
            >open here</span
          >
        </button>
      </li>
    </ul>
  </section>
</template>
