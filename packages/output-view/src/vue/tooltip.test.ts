// Tests tooltip.ts: a tip shows 300 ms after the pointer or the focus reaches its button, at once while a sibling's
// shows or just after, never after the pointer left first, and nothing after a close; a shortcut reads as
// aria-keyshortcuts. Time is the test's own scheduler and clock, not a faked global one.
import { describe, expect, it } from "vitest";

import { manualTime } from "./fixtures/time.js";
import { ariaKeys, shortcutWords, tooltipDelay, useTooltips } from "./tooltip.js";

/** A button in the document (a tip needs its anchor connected). */
const anchor = (): HTMLElement => document.body.appendChild(document.createElement("button"));
const tip = (at: HTMLElement, label = "Find") => ({ label, shortcut: "⌘F", anchor: at });

describe("useTooltips", () => {
  it("shows a tip 300 ms after its button is reached, and hides it when left", () => {
    const time = manualTime();
    const tips = useTooltips(time);
    const find = anchor();
    tips.show(tip(find));
    expect(time.delays()).toEqual([tooltipDelay]);
    time.advance(tooltipDelay - 1);
    expect(tips.shown.value).toBeUndefined();
    time.advance(1);
    expect(tips.shown.value?.label).toBe("Find");
    tips.hide(find);
    expect(tips.shown.value).toBeUndefined();
  });

  it("shows a sibling's tip at once, while one shows and just after it closed", () => {
    const time = manualTime();
    const tips = useTooltips(time);
    const [find, query] = [anchor(), anchor()];
    tips.show(tip(find));
    time.advance(tooltipDelay);
    tips.show(tip(query, "Query"));
    expect([tips.shown.value?.label, time.delays()]).toEqual(["Query", []]);
    tips.hide(query);
    time.advance(tooltipDelay - 1);
    tips.show(tip(find));
    expect(tips.shown.value?.label).toBe("Find");
  });
});

describe("useTooltips, leaving and closing", () => {
  it("forgets a tip whose button was left first, and waits again after a close", () => {
    const time = manualTime();
    const tips = useTooltips(time);
    const find = anchor();
    tips.show(tip(find));
    tips.hide(find);
    time.advance(tooltipDelay);
    expect(tips.shown.value).toBeUndefined();
    tips.show(tip(find));
    time.advance(tooltipDelay);
    tips.close();
    time.advance(tooltipDelay);
    tips.show(tip(find));
    expect([tips.shown.value, time.delays()]).toEqual([undefined, [tooltipDelay]]);
  });
});

describe("ariaKeys", () => {
  it("writes the shortcut as aria-keyshortcuts, with Ctrl for ⌘", () => {
    expect([ariaKeys("⌘⇧F"), ariaKeys("⇧↩"), ariaKeys("Esc"), ariaKeys(undefined)]).toEqual([
      "Meta+Shift+F Control+Shift+F",
      "Shift+Enter",
      "Escape",
      undefined,
    ]);
  });
});

describe("useTooltips and detached buttons", () => {
  it("ignores a button no longer in the document, and drops a pending tip whose button left it", () => {
    const time = manualTime();
    const tips = useTooltips(time);
    tips.show(tip(document.createElement("button")));
    expect([tips.shown.value, time.delays()]).toEqual([undefined, []]);
    const row = anchor();
    tips.show(tip(row, "Copy row"));
    row.remove();
    time.advance(tooltipDelay);
    expect(tips.shown.value).toBeUndefined();
  });
});

describe("shortcutWords", () => {
  it("says a shortcut in words, Cmd on a Mac and Ctrl elsewhere, and leaves a plain key alone", () => {
    expect([shortcutWords("⌘⇧F", true), shortcutWords("⌘C", false)]).toEqual([
      "Cmd Shift F",
      "Ctrl C",
    ]);
    expect([shortcutWords("⇧↩", true), shortcutWords("↩", true)]).toEqual(["Shift Enter", "Enter"]);
    expect([shortcutWords("Esc", true), shortcutWords("?", false)]).toEqual(["Esc", "?"]);
  });
});
