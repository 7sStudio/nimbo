// Virtual rows over a scroller (TanStack Virtual), shared by the tree and the grid: rows of one height, the ones in
// view plus an overscan, and a first measure that does not wait for layout (so tests and the first paint see rows).
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { Ref } from "vue";
import { computed } from "vue";

/** Row height in rem: 0.78125rem text at line-height 1.6, the tree's rows (ValueTree.css). */
const rowHeight = 1.25;

/** The first measure of a list before layout gives the real one, in rem: its width, and an uncapped one's height. */
const initial = { width: 40, uncapped: 50 };

/** The root font size in px, which rem lengths are read against (16 when the page reports none, as happy-dom may). */
function rootFontSize(): number {
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

export type VirtualRowsSource = {
  readonly count: Readonly<Ref<number>>;
  readonly scroller: Readonly<Ref<HTMLElement | null>>;
  readonly maxHeight: Readonly<Ref<number | undefined>>;
  /** The rows' height in rem when not the tree's 1.25 (the grid's are 1.5), as the view's CSS sets it. */
  readonly rowHeight?: number;
  /** Room above the first row and below the last, in rem, for targets taller than a row to stay inside the list. */
  readonly room?: number;
};

/** TanStack Virtual measures in px: every rem length is converted once, against the root font size at setup. */
export function useVirtualRows(source: VirtualRowsSource) {
  const rem = rootFontSize();
  const size = (source.rowHeight ?? rowHeight) * rem;
  const room = (source.room ?? 0) * rem;
  const virtualizer = useVirtualizer(
    computed(() => ({
      count: source.count.value,
      getScrollElement: () => source.scroller.value,
      estimateSize: () => size,
      overscan: 12,
      paddingStart: room,
      paddingEnd: room,
      initialRect: {
        width: initial.width * rem,
        height:
          source.maxHeight.value ??
          Math.min(initial.uncapped * rem, size * source.count.value + 2 * room),
      },
    })),
  );
  return {
    items: computed(() =>
      virtualizer.value.getVirtualItems().map(({ index, start }) => ({ index, start })),
    ),
    totalSize: computed(() => virtualizer.value.getTotalSize()),
    scrollTo: (index: number, align: "auto" | "center" = "auto") => {
      virtualizer.value.scrollToIndex(index, { align });
    },
  };
}
