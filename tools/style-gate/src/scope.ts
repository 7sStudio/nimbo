// What a package's compiled stylesheet may style: its root, its prefixed utilities and, inside them, a live slot that
// holds the user's elements. output-view's is .jsnb-ov, ov: and [data-live]; the ui's .jsnb-ui, ui: and [data-live], with the page's own
// tokens, fonts and keyframes (PageScope).

/** What a page's own sheet (the ui's) may set outside its root (rules/pageLevel.ts). */
export type PageScope = {
  /** The font families the page bundles with @font-face. */
  readonly fonts: readonly string[];
  /** The prefix every @keyframes name of the page carries: `jsnb-ui-`. */
  readonly keyframes: string;
};

export type GateScope = {
  /** The root's class, without its dot: `jsnb-ov`. */
  readonly root: string;
  /** The utilities' prefix, without its colon: `ov`. Two utilities under it carry what the style rules allow in one place only:
   * `<prefix>:fixed` (position: fixed, a full-screen dialog's) and `<prefix>:live-slot` (all: initial, the live slot's
   * reset). */
  readonly prefix: string;
  /** The live slot, the container that holds the user's elements, as a selector: `[data-live]`. */
  readonly live: string;
  /** The selectors of the rule that sets Tailwind's --tw-* initial values on the scope's elements (output-view's
   * tailwindScope.ts), Tailwind's values and not the package's, which the gate leaves out. */
  readonly defaults: readonly string[];
  /** A page's sheet: its :root tokens, fonts and keyframes; absent for a viewer, which sets none of them. */
  readonly page?: PageScope;
};
