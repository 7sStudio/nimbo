// The DOM snapshot of a container (04-kernel §5.5): the `dom` output after a run and the answer to realm.snapshot.

export type DomSnapshot = { readonly html: string; readonly text: string };

/** A same-origin frame's body text, when its document is readable; nothing for an opaque or cross-origin frame. */
const frameText = (frame: HTMLIFrameElement): string =>
  frame.contentDocument?.querySelector("body")?.innerText ?? "";

/** `html` is the container's innerHTML; `text` its rendered text (newlines between blocks) plus readable frames'. */
export function domSnapshot(container: HTMLElement): DomSnapshot {
  const own = container.isConnected ? container.innerText : container.textContent;
  const frames = [...container.querySelectorAll("iframe")].map(frameText);
  const text = [own, ...frames].filter((part) => part !== "").join("\n");
  return { html: container.innerHTML, text };
}
