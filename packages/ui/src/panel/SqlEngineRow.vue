<!-- SqlEngineRow: under the Query settings, the daemon's DuckDB binding, which SQL output queries from the CLI and agents run on (03-api §4.16); the page's own SQL runs on DuckDB-WASM and needs none of it. Shown only while it is not installed: one Install button (sql.install), the step under way from the sql.progress events, then Installed. Nothing installs unless clicked. -->
<script setup lang="ts">
import { Download } from "@lucide/vue";
import { onMounted } from "vue";

import Button from "../primitives/button/Button.vue";
import { useSqlEngineStore } from "../store/sqlEngine";

const props = defineProps<{ off: boolean }>();
const engine = useSqlEngineStore();
onMounted(() => void engine.load());
</script>

<template>
  <div
    v-if="engine.state === 'missing' || engine.state === 'installing' || engine.state === 'done'"
    data-part="sql-engine"
    class="ui:flex ui:flex-wrap ui:items-center ui:gap-2 ui:py-2.5 ui:ps-4 ui:pe-2 ui:text-ui ui:text-fg-2"
  >
    <span>DuckDB for CLI and agent SQL:</span>
    <template v-if="engine.state === 'missing'">
      <span>not installed</span>
      <Button size="sm" :disabled="props.off" @click="engine.install">
        <Download class="ui:block-[1cap] ui:inline-[1cap]" aria-hidden="true" />Install
      </Button>
    </template>
    <span v-else-if="engine.state === 'installing'" role="status"
      >Installing {{ engine.step }}</span
    >
    <span v-else role="status">Installed</span>
  </div>
</template>
