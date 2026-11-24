// Whether a block's sticky header is stuck to the top of the page's scroller: while `enabled`, the
// block's top has scrolled above the page's and enough of it is still below to hold the header. Measured on the page's
// scroll and resize, once per frame.
import type { Ref } from "vue";
import { onBeforeUnmount, ref, watch } from "vue";

import { remPx } from "./useResize.js";

/** The header's height and a little more, in rem: below this the block is leaving and the header goes with it. */
const room = 3;

export function useStuck(element: Readonly<Ref<HTMLElement | null>>, enabled: () => boolean) {
  const stuck = ref(false);
  let page: HTMLElement | null = null;
  let frame = 0;
  const measure = () => {
    frame = 0;
    const block = element.value;
    if (block === null || page === null || !enabled()) {
      stuck.value = false;
      return;
    }
    const box = block.getBoundingClientRect();
    const top = page.getBoundingClientRect().top;
    stuck.value = box.top < top - 1 && box.bottom > top + room * remPx();
  };
  const soon = () => {
    if (frame === 0) frame = requestAnimationFrame(measure);
  };
  const listen = (on: boolean) => {
    const method = on ? "addEventListener" : "removeEventListener";
    page?.[method]("scroll", soon, { passive: true });
    globalThis[method]("resize", soon, { passive: true });
  };
  // Side effect: the page's scroll is listened to while the block can stick; it stops with it.
  watch(
    [element, enabled],
    ([block, on]) => {
      listen(false);
      page = block !== null && on ? block.closest<HTMLElement>("#page") : null;
      listen(true);
      measure();
    },
    { immediate: true, flush: "post" },
  );
  onBeforeUnmount(() => {
    if (frame !== 0) cancelAnimationFrame(frame);
    listen(false);
  });
  return stuck;
}
