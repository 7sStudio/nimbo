<!-- NotebookGlimpse: what a notebook is, drawn from the page's own pieces on its ground: a server cell that exports a function, run in Node, and a client cell in the page that calls it across the bridge and draws its answer; the name they share is marked in the server's teal. A picture: hidden from a screen reader, whose heading and line above say the same. -->
<script setup lang="ts">
import { Check } from "@lucide/vue";

import TypeIcon from "../cells/TypeIcon.vue";

const head =
  "ui:grid ui:grid-cols-[1rem_1.25rem_auto_minmax(0,1fr)_auto] ui:items-center ui:gap-x-1.5 ui:bg-head ui:ps-2 ui:pe-2.5 ui:text-tiny ui:block-7";
const code =
  "ui:m-0 ui:grid ui:grid-cols-[1.5rem_minmax(0,1fr)] ui:bg-sheet ui:py-2 ui:pe-3 ui:font-mono ui:text-[0.6875rem] ui:leading-code ui:whitespace-pre ui:text-fg";
const shared = "ui:underline ui:decoration-server ui:decoration-dotted ui:underline-offset-[0.2em]";
</script>

<template>
  <div aria-hidden="true" class="ui:flex ui:flex-col ui:gap-2 ui:bg-ground ui:p-3 ui:select-none">
    <div>
      <div :class="head">
        <Check class="ui:text-ok ui:block-3 ui:inline-3" />
        <span class="ui:text-end ui:font-mono ui:text-muted">1</span>
        <span class="ui:flex ui:items-center ui:gap-1 ui:text-server-text">
          <TypeIcon type="server" class="ui:block-3 ui:inline-3" />server
        </span>
        <span class="ui:ellipsis ui:font-mono ui:text-fg">inStock</span>
        <span class="ui:text-muted">Node</span>
      </div>
      <pre :class="code"><span class="ui:text-end ui:pe-2 ui:text-muted">1
2
3</span><code><span class="ui:text-kw">export function</span> <span :class="['ui:text-fn', shared]">inStock</span>(fruit<span class="ui:text-punc">:</span> <span class="ui:text-typ">string</span>) {
  <span class="ui:text-ctl">return</span> stock.<span class="ui:text-fn">get</span>(fruit) ?? <span class="ui:text-num">0</span>;
}</code></pre>
    </div>
    <div>
      <div :class="head">
        <Check class="ui:text-ok ui:block-3 ui:inline-3" />
        <span class="ui:text-end ui:font-mono ui:text-muted">2</span>
        <span class="ui:flex ui:items-center ui:gap-1 ui:text-client-text">
          <TypeIcon type="client" class="ui:block-3 ui:inline-3" />client
        </span>
        <span class="ui:ellipsis ui:font-mono ui:text-fg">n</span>
        <span class="ui:text-muted">this page</span>
      </div>
      <pre :class="code"><span class="ui:text-end ui:pe-2 ui:text-muted">1
2</span><code><span class="ui:text-kw">const</span> n = <span class="ui:text-ctl">await</span> <span :class="['ui:text-fn', shared]">inStock</span>(<span class="ui:text-str">"pears"</span>);<span class="ui:relative ui:inline-block ui:border-s ui:border-hot ui:align-text-bottom ui:block-[1.2em] ui:inline-0 ui:motion-safe:animate-blink" />
display.<span class="ui:text-fn">div</span>().textContent = <span class="ui:text-str">`${n} pears`</span>;</code></pre>
      <div class="ui:bg-result ui:py-2 ui:ps-6 ui:pe-3 ui:text-ui ui:text-fg">3 pears</div>
    </div>
  </div>
</template>
