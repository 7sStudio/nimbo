// Full screen's crumbs scroll on purpose: a path longer than the head shows its end, the node in view,
// when the path changes and when the head's width does. A crumb a keyboard reaches scrolls itself into view.
import type { Ref } from "vue";
import { onScopeDispose, watch } from "vue";

export function useTrailEnd(
  trail: Readonly<Ref<HTMLElement | null>>,
  path: Readonly<Ref<unknown>>,
): void {
  const toEnd = (): void => {
    trail.value?.scrollTo({ left: trail.value.scrollWidth });
  };
  const observer = new ResizeObserver(toEnd);
  // Side effects: the trail is watched for size while it is shown, and scrolled to its end on every new path.
  watch(trail, (shown, gone) => {
    if (gone) observer.unobserve(gone);
    if (shown) observer.observe(shown);
  });
  watch([path, trail], toEnd, { flush: "post" });
  onScopeDispose(() => {
    observer.disconnect();
  });
}
