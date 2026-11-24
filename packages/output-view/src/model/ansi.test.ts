// Tests ansi.ts: SGR styles and colors, OSC 8 links, dropped escapes, carriage returns and the color table.
import { describe, expect, it } from "vitest";

import type { AnsiStyle } from "./ansi.js";
import { ansiRgb, parseAnsi, plainStyle, streamLines, stripAnsi } from "./ansi.js";

const esc = "\u001b";
const styled = (patch: Partial<AnsiStyle>): AnsiStyle => ({ ...plainStyle, ...patch });
const first = (text: string): AnsiStyle | undefined => parseAnsi(text)[0]?.style;

describe("parseAnsi colors", () => {
  it("splits text at SGR sequences and resets", () => {
    expect(parseAnsi(`${esc}[31mred${esc}[0m plain`)).toEqual([
      { text: "red", style: styled({ fg: { index: 1 } }) },
      { text: " plain", style: plainStyle },
    ]);
  });

  it("reads the sixteen named colors in both planes and their resets", () => {
    expect([first(`${esc}[92mx`), first(`${esc}[44mx`), first(`${esc}[105mx`)]).toEqual([
      styled({ fg: { index: 10 } }),
      styled({ bg: { index: 4 } }),
      styled({ bg: { index: 13 } }),
    ]);
    expect(first(`${esc}[31;41;39;49mx`)).toEqual(plainStyle);
  });

  it("reads 256 colors and 24-bit colors, and stops at a malformed one", () => {
    expect(first(`${esc}[38;5;208mx`)).toEqual(styled({ fg: { index: 208 } }));
    expect(first(`${esc}[48;2;10;20;300mx`)).toEqual(styled({ bg: { rgb: [10, 20, 255] } }));
    expect(first(`${esc}[38;9;1mx`)).toEqual(plainStyle);
  });
});

describe("parseAnsi styles", () => {
  it("sets and clears each style", () => {
    expect(first(`${esc}[1;2;3;4;7;8;9mx`)).toEqual(
      styled({
        bold: true,
        dim: true,
        italic: true,
        underline: true,
        inverse: true,
        hidden: true,
        strike: true,
      }),
    );
    expect(first(`${esc}[1;2;3;4;7;8;9;22;23;24;27;28;29mx`)).toEqual(plainStyle);
    expect([first(`${esc}[21mx`), first(`${esc}[1m${esc}[mx`)]).toEqual([
      styled({ underline: true }),
      plainStyle,
    ]);
  });

  it("ignores codes it does not know", () => {
    expect(first(`${esc}[5;53mx`)).toEqual(plainStyle);
  });
});

describe("parseAnsi escapes", () => {
  it("wraps OSC 8 hyperlinks around their text, http(s) only", () => {
    const link = `${esc}]8;;https://stripe.com${esc}\\docs${esc}]8;;${esc}\\ after`;
    expect(parseAnsi(link)).toEqual([
      { text: "docs", style: plainStyle, link: "https://stripe.com" },
      { text: " after", style: plainStyle },
    ]);
    expect(parseAnsi(`${esc}]8;;file:///etc/passwd\u0007x`)).toEqual([
      { text: "x", style: plainStyle },
    ]);
  });

  it("drops every other escape: cursor moves, titles, a lone ESC", () => {
    expect(parseAnsi(`a${esc}[2Kb${esc}]0;title\u0007c${esc}d${esc}`)).toEqual([
      { text: "a", style: plainStyle },
      { text: "b", style: plainStyle },
      { text: "c", style: plainStyle },
      { text: "d", style: plainStyle },
    ]);
    expect(stripAnsi(`${esc}[1mbold${esc}[0m`)).toBe("bold");
  });
});

describe("streamLines", () => {
  it("splits lines and keeps what follows the last carriage return", () => {
    expect(streamLines("a\r\nprogress 10%\rprogress 100%\nend")).toEqual([
      "a",
      "progress 100%",
      "end",
    ]);
  });

  it("ends the last line at a final newline, as a terminal shows it", () => {
    expect([
      streamLines("a\nb\n"),
      streamLines("\n"),
      streamLines("a\n\n"),
      streamLines(""),
    ]).toEqual([["a", "b"], [""], ["a", ""], []]);
  });
});

describe("ansiRgb", () => {
  it("knows the named colors, xterm's cube and grey ramp, and passes 24-bit colors", () => {
    expect([
      ansiRgb({ index: 1 }),
      ansiRgb({ index: 16 }),
      ansiRgb({ index: 196 }),
      ansiRgb({ index: 232 }),
      ansiRgb({ index: 999 }),
      ansiRgb({ rgb: [1, 2, 3] }),
    ]).toEqual([
      [205, 49, 49],
      [0, 0, 0],
      [255, 0, 0],
      [8, 8, 8],
      [238, 238, 238],
      [1, 2, 3],
    ]);
  });
});
