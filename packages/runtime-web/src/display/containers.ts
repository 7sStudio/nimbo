// The cell containers (04-kernel §5.5): one per cell, created on first use, kept across runs.

/** Places a new container in the page; the host slots it once (ui's DomView), the default appends it to the body. */
export type Mount = (cell: string, container: HTMLElement) => void;

/** User output inherits `color-scheme` and nothing else; `font` and the rest reset to initial. */
const containerStyle = "all: initial; display: block; color-scheme: inherit";

export type Containers = {
  readonly get: (cell: string) => HTMLElement | undefined;
  /** The cell's container, created and mounted synchronously on first use, so user code sees a connected node. */
  readonly ensure: (cell: string) => HTMLElement;
  /** Emptied before the cell re-runs (04-kernel §7): a Vue app mounted in it is unmounted, its children go (a swapped-in iframe too) and its attributes are
   * its own again, so a style a run set does not outlive it. */
  readonly empty: (cell: string) => void;
  /** The full reset: every container leaves the registry and the DOM. */
  readonly removeAll: () => void;
};

/** The app Vue's `app.mount(el)` leaves on `el`, whose `unmount()` stops its effects and runs its hooks. */
type VueApp = { readonly unmount: () => void };

const isVueApp = (value: unknown): value is VueApp =>
  typeof value === "object" &&
  value !== null &&
  "unmount" in value &&
  typeof value.unmount === "function";

/**
 * Unmounts each Vue app mounted on the container or inside it, before its nodes go: an app whose element left the page
 * would keep its watchers and listeners, and a cell's state read by another cell would still drive it. Vue's
 * `unmount()` removes its own mark, so an app a disposer already unmounted is not unmounted twice.
 */
function unmountApps(container: HTMLElement): void {
  for (const element of [container, ...container.querySelectorAll("*")]) {
    const app: unknown = Reflect.get(element, "__vue_app__");
    if (!isVueApp(app)) continue;
    try {
      app.unmount();
    } catch {
      // the app's own failure while unmounting; its nodes go regardless
    }
  }
}

export const appendToBody: Mount = (_cell, container) => {
  document.body.append(container);
};

/** The container's own attributes, and nothing else; the attribute, not style.cssText, which Chromium would expand. */
function ownAttributes(container: HTMLElement, cell: string): void {
  for (const name of container.getAttributeNames()) container.removeAttribute(name);
  container.setAttribute("data-jsnb-cell", cell);
  container.setAttribute("style", containerStyle);
}

export function createContainers(mount: Mount): Containers {
  const byCell = new Map<string, HTMLElement>();
  const create = (cell: string): HTMLElement => {
    const container = document.createElement("div");
    ownAttributes(container, cell);
    byCell.set(cell, container);
    mount(cell, container);
    return container;
  };
  return {
    get: (cell) => byCell.get(cell),
    ensure: (cell) => byCell.get(cell) ?? create(cell),
    empty: (cell) => {
      const container = byCell.get(cell);
      if (container) unmountApps(container);
      container?.replaceChildren();
      if (container) ownAttributes(container, cell);
    },
    removeAll: () => {
      for (const container of byCell.values()) {
        unmountApps(container);
        container.remove();
      }
      byCell.clear();
    },
  };
}
