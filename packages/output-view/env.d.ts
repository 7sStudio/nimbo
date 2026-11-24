// Ambient types for tsc: the shape of a .vue module (vue-tsc reads the single-file components themselves).
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent;
  export default component;
}
