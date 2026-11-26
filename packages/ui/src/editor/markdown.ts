// The markdown renderer on demand: marked and DOMPurify are a chunk of their own (render.ts), loaded once
// when a markdown block first renders, so the page's first load stays inside
// its budget.
type Render = (source: string) => string;

let loading: Promise<Render> | undefined;

/** The renderer, loaded once. */
export function loadMarkdown(): Promise<Render> {
  loading ??= import("./render.js").then((module) => module.renderMarkdown);
  return loading;
}
