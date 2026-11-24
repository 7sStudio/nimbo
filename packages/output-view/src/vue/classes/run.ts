// A stream run's ANSI style (terminal.ts): its colors from the custom properties the view computes (--run-fg, --run-bg,
// through the inline theme), the rest from its data- attributes; underline and strike together draw both lines.
export const run =
  "ov:data-bg:bg-run-bg ov:data-bold:font-semibold ov:data-dim:opacity-70 ov:data-fg:text-run-fg ov:data-hidden:invisible ov:data-italic:italic ov:data-strike:line-through ov:data-underline:underline ov:data-underline:data-strike:[text-decoration-line:underline_line-through]";
