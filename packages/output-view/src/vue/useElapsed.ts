// The time a query has been running, for the bar's "Running, 1.2 s" (11-query §4: "a running query shows elapsed
// time"), ticking every 100 ms only while it runs.
import type { Ref } from "vue";
import { onScopeDispose, ref, watch } from "vue";

export function useElapsed(running: Readonly<Ref<boolean>>) {
  const ms = ref(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  // Side effect: a clock that runs while the query does.
  watch(running, (now) => {
    stop();
    if (!now) return;
    const started = performance.now();
    ms.value = 0;
    timer = setInterval(() => {
      ms.value = performance.now() - started;
    }, 100);
  });
  onScopeDispose(stop);
  return ms;
}
