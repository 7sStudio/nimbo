// The clock a running state reads its elapsed time from (the kernel busy with its elapsed time): a ref of
// Date.now() that ticks every `ms` while `active` holds and stands still otherwise, so an idle page runs no timer.
import type { Ref } from "vue";
import { getCurrentScope, onScopeDispose, ref, watch } from "vue";

export function useNow(active: () => boolean, ms: number): Readonly<Ref<number>> {
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };
  // side effect: a ticking interval while active, none otherwise
  watch(
    active,
    (on) => {
      stop();
      now.value = Date.now();
      if (on)
        timer = setInterval(() => {
          now.value = Date.now();
        }, ms);
    },
    { immediate: true },
  );
  if (getCurrentScope() !== undefined) onScopeDispose(stop);
  return now;
}
