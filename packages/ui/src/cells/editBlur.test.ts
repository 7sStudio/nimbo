// blurOutcome: where the focus went after an editor's blur, and the last
// press, decide whether edit mode stays, goes back to the editor, or leaves.
import { afterEach, describe, expect, it } from "vitest";

import type { Press } from "./editBlur.js";
import { blurOutcome } from "./editBlur.js";

const row = (cell: string, inner: string) => {
  const item = document.createElement("li");
  item.dataset.cell = cell;
  item.innerHTML = inner;
  document.body.append(item);
  return item;
};
const editing = { overlay: null, mode: "edit" } as const;
const now = 10_000;
const pressed = (cell: string | null, ago = 50): Press => ({ at: now - ago, cell });
const never: Press = { at: Number.NEGATIVE_INFINITY, cell: null };

afterEach(() => {
  document.body.replaceChildren();
});

describe("blurOutcome", () => {
  it("stays while the focus is in an editor, the cell's own markdown toolbar, or the menu it opened", () => {
    const own = row("c1", '<div class="cm-editor"><div class="cm-content"></div></div>');
    const card = row("c1b", '<div data-part="markdown-card"><button>Move up</button></div>');
    expect(
      blurOutcome("c1", {
        ui: editing,
        active: own.querySelector(".cm-content"),
        press: never,
        now,
      }),
    ).toBe("stay");
    expect(
      blurOutcome("c1b", { ui: editing, active: card.querySelector("button"), press: never, now }),
    ).toBe("stay");
    expect(
      blurOutcome("c1", { ui: editing, active: card.querySelector("button"), press: never, now }),
    ).toBe("leave");
    const menu = { overlay: { kind: "cellMenu", cell: "c1", at: null }, mode: "edit" } as const;
    expect(blurOutcome("c1", { ui: menu, active: document.body, press: pressed("c1"), now })).toBe(
      "stay",
    );
  });
});

describe("blurOutcome of a focus lost to nowhere", () => {
  it("goes back to the editor after no press or a press in the cell's own row", () => {
    expect(blurOutcome("c1", { ui: editing, active: document.body, press: never, now })).toBe(
      "refocus",
    );
    expect(blurOutcome("c1", { ui: editing, active: null, press: pressed(null, 5000), now })).toBe(
      "refocus",
    );
    // a second Move after an earlier blur: the press was on the card's own toolbar
    expect(
      blurOutcome("c1", { ui: editing, active: document.body, press: pressed("c1"), now }),
    ).toBe("refocus");
  });
});

describe("blurOutcome after a press elsewhere", () => {
  it("leaves after a press elsewhere, on another control, or out of edit mode", () => {
    expect(
      blurOutcome("c1", { ui: editing, active: document.body, press: pressed(null), now }),
    ).toBe("leave");
    expect(
      blurOutcome("c1", { ui: editing, active: document.body, press: pressed("c2"), now }),
    ).toBe("leave");
    const other = row("c2", "<button>Run</button>");
    expect(
      blurOutcome("c1", { ui: editing, active: other.querySelector("button"), press: never, now }),
    ).toBe("leave");
    expect(
      blurOutcome("c1", {
        ui: { overlay: null, mode: "command" },
        active: document.body,
        press: never,
        now,
      }),
    ).toBe("leave");
  });
});
