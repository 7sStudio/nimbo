// The entry a note becomes: what locate.ts reads of the element, the page it is on (its path without the token), the
// viewport, the theme and the build, with the screenshots taken as it was picked.
import { pageAddress } from "../store/address.js";
import type { FeedbackDraft, Located, Rect, Shots } from "../store/feedbackApi.js";

/** The theme the page shows: the setting's choice, or the system's. */
function themeNow(): string {
  const chosen = document.documentElement.dataset.theme;
  if (chosen !== undefined) return chosen;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The page's path and kind; the token stays out of the entry. */
export function pageNow(): Pick<FeedbackDraft["page"], "kind" | "path" | "notebook"> {
  const address = pageAddress(location);
  const kind =
    address?.home === true ? "home" : address?.output !== undefined ? "output" : "notebook";
  return { kind, path: location.pathname, notebook: address?.notebook ?? "" };
}

const build = {
  version: typeof __JSNB_VERSION__ === "string" ? __JSNB_VERSION__ : "dev",
  commit: typeof __JSNB_COMMIT__ === "string" ? __JSNB_COMMIT__ : "dev",
};

export function draftOf(
  text: string,
  located: Located,
  area: Rect | undefined,
  shots: Shots,
): FeedbackDraft {
  return {
    text,
    selector: located.selector,
    components: located.components,
    element: located.element,
    ...(area === undefined ? {} : { area }),
    page: {
      ...pageNow(),
      ...(located.cell === undefined ? {} : { cell: located.cell }),
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      },
      theme: themeNow(),
    },
    app: build,
    shots,
  };
}
