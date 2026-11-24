// The class lists the side views, the inspector and the bottom panel share, so their rows line up and read as one
// family: a row is 26 px tall (1.625rem) with no rule under it, a hovered or current one takes the code's white.
/** A row that is a button or a link: hover and focus on white, the current one white with ink text. */
export const rowButton =
  "ui:flex ui:cursor-pointer ui:items-center ui:gap-1.75 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:ps-1 ui:pe-2 ui:text-start ui:font-inherit ui:text-fg-2 ui:no-underline ui:block-6.5 ui:inline-full ui:min-inline-0 ui:hover:bg-sheet ui:focus-visible:border-accent ui:aria-[current]:bg-sheet ui:aria-[current]:font-semibold ui:aria-[current]:text-fg";
/** The quiet words at a row's end: a time, a state, a count. */
export const rowEnd =
  "ui:ms-auto ui:shrink-0 ui:ps-2 ui:text-tiny ui:whitespace-nowrap ui:text-muted";
/** A line of explanation under a view's title or a section. */
export const note = "ui:m-0 ui:px-1 ui:text-tiny ui:text-muted";
/** A small word button inside a row or a section's head (Add, Edit, Copy URL). */
export const wordButton =
  "ui:inline-flex ui:shrink-0 ui:cursor-pointer ui:items-center ui:gap-1 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-1 ui:text-tiny ui:font-medium ui:whitespace-nowrap ui:text-fg ui:block-5.5 ui:hover:bg-well ui:focus-visible:border-accent ui:disabled:pointer-events-none ui:disabled:opacity-45";
/** A row's own action (Edit, Remove) that shows while the row is hovered or holds the keyboard's focus: it stays in the
 * tab order and in the accessibility tree, only hidden from sight while the row is at rest. The row is a group/row. */
export const rowAction =
  "ui:opacity-0 ui:group-hover/row:opacity-100 ui:group-has-[:focus-visible]/row:opacity-100 ui:focus-visible:opacity-100";
