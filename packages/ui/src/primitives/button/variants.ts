// The class-variance-authority variants of the button primitive: one square, quiet family with no outline box. A white
// button on a toned surface, the ink primary, the orange go (Run all alone), a ghost and a danger one, at 28 px and
// 22 px (1.75rem, 1.375rem).
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "ui:inline-flex ui:shrink-0 ui:cursor-pointer ui:items-center ui:justify-center ui:gap-1.5 ui:rounded-control ui:border ui:border-transparent ui:font-medium ui:whitespace-nowrap ui:select-none ui:focus-visible:border-accent ui:disabled:pointer-events-none ui:disabled:opacity-45 ui:aria-disabled:cursor-default ui:aria-disabled:opacity-45 ui:motion-safe:transition-colors ui:motion-safe:active:scale-98",
  {
    variants: {
      variant: {
        default: "ui:bg-sheet ui:text-fg ui:hover:bg-well ui:active:bg-grip",
        primary: "ui:bg-chip ui:text-chip-fg ui:hover:opacity-90",
        go: "ui:bg-fill ui:text-fill-fg ui:hover:opacity-90 ui:disabled:bg-well ui:disabled:text-muted",
        outline: "ui:border-border ui:bg-bg ui:text-fg ui:hover:bg-surface-2 ui:active:bg-well",
        ghost:
          "ui:bg-transparent ui:text-muted ui:hover:bg-well ui:hover:text-fg ui:active:bg-grip",
        danger: "ui:bg-sheet ui:text-err ui:hover:bg-err-soft ui:active:bg-well",
      },
      size: {
        default: "ui:block-7 ui:px-2.75 ui:text-ui",
        sm: "ui:block-5.5 ui:px-2 ui:text-tiny",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export type ButtonVariants = VariantProps<typeof buttonVariants>;
