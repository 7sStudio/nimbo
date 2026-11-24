// Public API of @jsnb/output-view: OutputView with the built-in renderers (HTML, images), the
// renderer registry hosts extend, the injection key behind it, and the types of the viewer's props and events. The
// pure model is the "./model" subpath; the stylesheets are "./theme.css" (tokens) and "./style.css" (the views).
export { default as OutputView } from "./renderers/DefaultOutputView.vue";
export { createRenderers, defaultRenderers } from "./renderers/registry.js";
export type { RendererRegistry } from "./vue/renderers.js";
export { rendererKey } from "./vue/renderers.js";
export type {
  CopyEvent,
  JumpTarget,
  LoadMoreRequest,
  OutputHeight,
  OutputViewEmits,
  OutputViewOptions,
  OutputViewProps,
} from "./vue/options.js";
export { defaultMaxHeight } from "./vue/options.js";
