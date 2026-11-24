// A view's scroller, the tree's and the grid's: monospace values with figures of one width, capped by --max-height, or
// by --fit-height when it fits (most of the window; none in full screen, where it fills the dialog between the head and
// the foot), and ringed in --accent-soft under the keyboard.
export const viewScroller =
  "ov:relative ov:overflow-auto ov:font-mono ov:text-value ov:leading-code ov:tabular-nums ov:not-data-capped:max-block-[var(--fit-height,85vh)] ov:focus-visible:ring-[0.1875rem] ov:focus-visible:ring-accent-soft ov:data-capped:max-block-(--max-height) ov:in-data-[part=dialog]:min-block-0 ov:in-data-[part=dialog]:flex-1";
