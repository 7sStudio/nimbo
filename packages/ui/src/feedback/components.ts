// The chain of Vue components that render an element, read from the app's vnode tree (a production build keeps it on
// the mount point as `_vnode`; `__vueParentComponent` is development only): the names a fix starts from, without the
// framework's and Reka UI's plumbing.

type VNodeLike = {
  readonly type: unknown;
  readonly el: unknown;
  readonly component: { readonly subTree: VNodeLike; readonly type: unknown } | null;
  readonly suspense?: { readonly activeBranch: VNodeLike | null } | null;
  readonly children: unknown;
};

/** Names that only wrap: the framework's and the primitives' plumbing, never where a fix goes. */
const plumbing = new Set([
  "App",
  "TooltipProvider",
  "BaseTransition",
  "Transition",
  "TransitionGroup",
  "KeepAlive",
  "Teleport",
  "Suspense",
  "AsyncComponentWrapper",
  "Primitive",
  "Slot",
  "Presence",
  "PopperContent",
  "DismissableLayer",
  "FocusScope",
  "Teleport",
  "TeleportPrimitive",
  "CollectionSlot",
  "CollectionItem",
  "RovingFocusItem",
  "RovingFocusGroup",
  "VisuallyHidden",
]);

/** Reka UI's internals by their names' shape: the parts behind a primitive, never the page's own components. */
const library =
  /^(Primitive|Popper|Collection|RovingFocus|Dismissable|FocusScope|Presence|Teleport|VisuallyHidden|ConfigProvider|Menu[A-Z]|MenubarMenu|ContextMenu|ToggleGroup|Tooltip(Root|Trigger|Portal))|(Impl|Root|Portal|Provider|Modal|NonModal)$/u;

const nameOf = (type: unknown): string | undefined => {
  if (typeof type !== "object" || type === null) return undefined;
  const name: unknown = Reflect.get(type, "name") ?? Reflect.get(type, "__name");
  if (typeof name !== "string" || name === "" || plumbing.has(name)) return undefined;
  return library.test(name) ? undefined : name;
};

const isVNode = (value: unknown): value is VNodeLike =>
  typeof value === "object" && value !== null && "type" in value && "el" in value;

/** A vnode's own element when it is an element's vnode (a component's or a fragment's `el` is an anchor). */
const elementOf = (vnode: VNodeLike): Node | undefined =>
  typeof vnode.type === "string" && vnode.el instanceof Node ? vnode.el : undefined;

const childrenOf = (vnode: VNodeLike): readonly VNodeLike[] =>
  Array.isArray(vnode.children) ? vnode.children.filter(isVNode) : [];

/** The components from the root down to the deepest one whose DOM holds `target`. */
function chainTo(
  vnode: VNodeLike,
  target: Node,
  chain: readonly string[],
): readonly string[] | undefined {
  if (vnode.component !== null) {
    const name = nameOf(vnode.component.type);
    return chainTo(vnode.component.subTree, target, name === undefined ? chain : [...chain, name]);
  }
  const branch = vnode.suspense?.activeBranch;
  if (branch) return chainTo(branch, target, chain);
  const el = elementOf(vnode);
  // an element that does not hold the target: nothing below it does either
  if (el !== undefined && !el.contains(target)) return undefined;
  for (const child of childrenOf(vnode)) {
    const found = chainTo(child, target, chain);
    if (found !== undefined) return found;
  }
  return el === undefined ? undefined : chain;
}

/** The Vue components that render `element`, outermost first, without consecutive repeats; [] outside the app. */
export function componentsOf(
  element: Element,
  app: Element | null = document.getElementById("app"),
): string[] {
  const root: unknown = app === null ? undefined : Reflect.get(app, "_vnode");
  const chain = isVNode(root) ? (chainTo(root, element, []) ?? []) : [];
  return chain.filter((name, at) => name !== chain[at - 1]);
}
