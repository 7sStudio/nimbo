// Whether the output's view is cut by the height cap ("inner scroll and an expand control"), so
// "Expand" shows only when there is more to see: the view's scroller measured whenever it, its body or its lines change.
import type { Ref } from "vue";
import { onBeforeUnmount, onMounted, onUpdated, ref } from "vue";

/** The elements that scroll inside the cap: the tree, the grid, the raw text and the stream. */
const scrollers = '[data-part="tree"], [data-part="grid"], [data-part="raw"], [data-part="stream"]';
/** The bodies whose size is the content's (a virtual list's full height). */
const bodies = '[data-part="tree-body"], [data-part="grid-body"]';

export function useOverflow(root: Readonly<Ref<HTMLElement | null>>) {
  const overflows = ref(false);
  let watched: Element | null = null;
  let resize: ResizeObserver | undefined;
  let lines: MutationObserver | undefined;

  const measure = (): void => {
    const scroller = root.value?.querySelector(scrollers) ?? null;
    overflows.value = scroller !== null && scroller.scrollHeight > scroller.clientHeight + 1;
  };
  /** Observes the current scroller once per element: its size, its body's, and lines added to it (a stream). */
  const observe = (): void => {
    const scroller = root.value?.querySelector(scrollers) ?? null;
    if (scroller === watched) return;
    resize?.disconnect();
    lines?.disconnect();
    watched = scroller;
    if (scroller === null || typeof ResizeObserver === "undefined") return;
    resize = new ResizeObserver(measure);
    resize.observe(scroller);
    const body = scroller.querySelector(bodies);
    if (body) resize.observe(body);
    lines = new MutationObserver(measure);
    lines.observe(scroller, { childList: true });
  };
  const refresh = (): void => {
    observe();
    measure();
  };
  // Side effects: the observers follow the view the output shows; they stop with it.
  onMounted(refresh);
  onUpdated(refresh);
  onBeforeUnmount(() => {
    resize?.disconnect();
    lines?.disconnect();
  });
  return overflows;
}
