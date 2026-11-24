// The built-in renderers ("text/html and images in v1"), and the registry a host extends: by mime
// (`image/*` covers a family) or by view kind, a later entry winning.
import type { Component } from "vue";

import type { ShownView } from "../model/detect.js";
import type { RendererRegistry } from "../vue/renderers.js";
import { mergeRegistries } from "../vue/renderers.js";
import HtmlRenderer from "./HtmlRenderer.vue";
import ImageRenderer from "./ImageRenderer.vue";

export const defaultRenderers: RendererRegistry = {
  mimes: { "text/html": HtmlRenderer, "image/*": ImageRenderer },
  kinds: {},
};

/** The default renderers plus a host's: `mimes` by type or family, `kinds` replacing a built-in view. */
export const createRenderers = (
  extra: {
    readonly mimes?: Readonly<Record<string, Component>>;
    readonly kinds?: Readonly<Partial<Record<ShownView, Component>>>;
  } = {},
): RendererRegistry =>
  mergeRegistries(defaultRenderers, { mimes: extra.mimes ?? {}, kinds: extra.kinds ?? {} });
