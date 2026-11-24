// Ambient types for the page: Vite's client API and the shape of a .vue module for tsc.
/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent;
  export default component;
}

/** The build's commit and package version, set by vite.config.ts (undefined under Vitest). */
declare const __JSNB_COMMIT__: string | undefined;
declare const __JSNB_VERSION__: string | undefined;
