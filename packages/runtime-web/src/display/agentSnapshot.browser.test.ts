// Tests cell.snapshot's reading of a container in Chromium: a chart's SVG labels and a progress bar in the text, hidden
// parts left out, frames read, and the cut at a character boundary.
import { afterEach, describe, expect, it } from "vitest";

import { agentSnapshot } from "./agentSnapshot.js";

const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const each of mounted.splice(0)) each.remove();
});

function container(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  mounted.push(root);
  return root;
}

describe("agentSnapshot", () => {
  it("reads a chart's labels one per line, a progress bar's value and leaves hidden parts out", () => {
    const root = container(
      '<svg><text x="0" y="10">North 120</text><text x="0" y="30">South 80</text></svg>' +
        '<progress max="30" value="12"></progress><span style="display:none">gone</span>' +
        '<span aria-hidden="true">icon</span><button aria-label="Close"></button>',
    );
    expect(agentSnapshot(root, 1000).text).toBe("North 120\nSouth 80\n[12/30] Close");
  });

  it("cuts html and text at maxBytes without splitting a character, and says so", () => {
    const root = container("<p>héllo 😀 world</p>");
    const shot = agentSnapshot(root, 10);
    expect(shot.truncated).toBe(true);
    expect(shot.text).toBe("héllo ");
    expect(new TextEncoder().encode(shot.html).length).toBeLessThanOrEqual(10);
    expect(agentSnapshot(root, 1000)).toEqual({
      html: "<p>héllo 😀 world</p>",
      text: "héllo 😀 world",
      truncated: false,
    });
  });
});
