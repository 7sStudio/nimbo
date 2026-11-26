// Where every overlay primitive (dialog, menu, tooltip, toast) teleports: the page's .jsnb-ui root, not <body>, so an
// overlay keeps the scoped reset, the tokens' context and the ui: utilities' scope (Reka's portals default to
// <body>, outside .jsnb-ui).
export const overlayHost = ".jsnb-ui";
