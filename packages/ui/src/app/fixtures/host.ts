// The page's .jsnb-ui root for a component test, where every overlay teleports (primitives/overlay.ts).

export function host(): HTMLElement {
  const root = document.createElement("div");
  root.className = "jsnb-ui";
  document.body.replaceChildren(root);
  return root;
}
