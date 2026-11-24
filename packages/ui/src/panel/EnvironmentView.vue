<!-- EnvironmentView: everything this notebook needs before it can run, in one place: the packages it imports and the secrets it reads. Nothing here changes when a cell runs; what a run produces is in the inspector, on the other side. -->
<script setup lang="ts">
import PackagesSection from "./PackagesSection.vue";
import SecretsSection from "./SecretsSection.vue";
import ViewHead from "./ViewHead.vue";
</script>

<template>
  <ViewHead id="side-title" title="Environment" region="side" />
  <div class="ui:flex ui:flex-1 ui:flex-col ui:overflow-y-auto ui:min-block-0">
    <PackagesSection />
    <SecretsSection />
  </div>
</template>
