// The page's scope for Tailwind's --tw-* internals and the 08 §7 gate: .jsnb-ui, without a client cell's live
// container (04 §5.5), which holds the user's elements.
export const pageScope = { scope: ".jsnb-ui", except: "[data-live]" } as const;
