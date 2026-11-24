// The renderer registry ("ViewKind or mime → component; hosts register more"): a host component
// that renders a display mime (text/html, images, a future chart) or replaces a whole view kind. Renderers receive
// the output as their one prop, `output`.
import type { Component, InjectionKey } from "vue";

import type { ShownView } from "../model/detect.js";
import type { ViewInput } from "../model/output.js";

export type RendererRegistry = {
  /** By mime: an exact type (`text/html`) or a family (`image/*`). */
  readonly mimes: Readonly<Record<string, Component>>;
  /** By view kind, replacing the built-in view of that kind. */
  readonly kinds: Readonly<Partial<Record<ShownView, Component>>>;
};

export const emptyRegistry: RendererRegistry = { mimes: {}, kinds: {} };

export const rendererKey: InjectionKey<RendererRegistry> = Symbol("jsnb-output-view-renderers");

/** The registered renderer for an output, by its view kind first, then by its display mime. */
export function rendererFor(
  registry: RendererRegistry,
  input: ViewInput,
  shown: ShownView,
): Component | undefined {
  const byKind = registry.kinds[shown];
  if (byKind !== undefined || input.kind !== "display") return byKind;
  const family = `${input.mime.split("/")[0] ?? ""}/*`;
  return registry.mimes[input.mime] ?? registry.mimes[family];
}

/** Registries merged left to right: a later one's entries win. */
export const mergeRegistries = (...registries: readonly RendererRegistry[]): RendererRegistry =>
  registries.reduce<RendererRegistry>(
    (merged, registry) => ({
      mimes: { ...merged.mimes, ...registry.mimes },
      kinds: { ...merged.kinds, ...registry.kinds },
    }),
    emptyRegistry,
  );
