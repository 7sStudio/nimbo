// Whether a condition has held for longer than `ms` (the shell's "still reconnecting" hint): a ref that
// turns true once the condition stayed true that long, and false again the moment it ends.
import type { Ref } from "vue";
import { getCurrentScope, onScopeDispose, ref, watch } from "vue";

export function useLongWait(condition: () => boolean, ms: number): Readonly<Ref<boolean>> {
  const long = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  // side effect: a timer started when the condition begins, dropped when it ends
  watch(
    condition,
    (holds) => {
      clear();
      long.value = false;
      if (holds)
        timer = setTimeout(() => {
          long.value = true;
        }, ms);
    },
    { immediate: true },
  );
  if (getCurrentScope() !== undefined) onScopeDispose(clear);
  return long;
}
