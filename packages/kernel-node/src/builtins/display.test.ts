// Tests display: the outputs display makes.
import type { Output } from "@jsnb/core";
import { encode } from "@jsnb/core";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDisplay } from "./display.js";

const redact = (text: string): string => text.replaceAll("secret-value", "***");

const capture = (cwd?: string) => {
  const outputs: Output[] = [];
  const display = createDisplay({
    emit: (output) => outputs.push(output),
    encode: (value) => encode(value, { redact }).json,
    redact,
    ...(cwd === undefined ? {} : { cwd }),
  });
  return { display, outputs };
};

describe("createDisplay", () => {
  it("emits html as a text/html display output, redacted", () => {
    const { display, outputs } = capture();
    display.html("<b>secret-value</b>");
    display.html(42);
    expect(outputs).toEqual([
      { kind: "display", mime: "text/html", data: "<b>***</b>" },
      { kind: "display", mime: "text/html", data: "42" },
    ]);
  });

  it("emits a value's wire form as application/json text, redacted", () => {
    const { display, outputs } = capture();
    display.json({ when: new Date(0), key: "secret-value" });
    expect(outputs).toEqual([
      {
        kind: "display",
        mime: "application/json",
        data: '{"when":{"$type":"date","iso":"1970-01-01T00:00:00.000Z"},"key":"***"}',
      },
    ]);
  });
});

describe("display.table and display.image", () => {
  it("emits rows as a table: an array as given, an object's or a Map's entries as rows, columns picked", () => {
    const { display, outputs } = capture();
    display.table([{ a: 1, b: "secret-value" }], { columns: ["b"] });
    display.table({ x: 1 });
    display.table(new Map([["k", 2]]));
    expect(outputs.map((output) => output.kind === "display" && output.data)).toEqual([
      '[{"b":"***"}]',
      '[{"key":"x","value":1}]',
      '[{"key":"k","value":2}]',
    ]);
    expect(new Set(outputs.map((output) => output.kind === "display" && output.mime))).toEqual(
      new Set(["application/vnd.jsnb.table+json"]),
    );
  });

  it("emits an image from bytes by their signature, a data or https URL, SVG text or a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "display-"));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(join(dir, "pic.png"), png);
    const { display, outputs } = capture(dir);
    display.image(png);
    display.image("pic.png");
    display.image("https://example.com/a.jpg?k=secret-value");
    display.image("data:image/gif;base64,R0lGOD");
    display.image('<svg xmlns="http://www.w3.org/2000/svg"><text>secret-value</text></svg>');
    expect(outputs).toEqual([
      { kind: "display", mime: "image/png", data: png.toString("base64") },
      { kind: "display", mime: "image/png", data: png.toString("base64") },
      { kind: "display", mime: "image/jpeg", data: "https://example.com/a.jpg?k=***" },
      { kind: "display", mime: "image/gif", data: "R0lGOD" },
      {
        kind: "display",
        mime: "image/svg+xml",
        data: '<svg xmlns="http://www.w3.org/2000/svg"><text>***</text></svg>',
      },
    ]);
  });
});

describe("display", () => {
  it("refuses bytes of no known image type", () => {
    const { display } = capture();
    expect(() => {
      display.image(new Uint8Array([1, 2, 3]));
    }).toThrow(/unknown image type/u);
  });

  it("cannot be changed", () => {
    const { display } = capture();
    expect(Object.keys(display)).toEqual(["html", "json", "table", "image"]);
    expect(Object.isFrozen(display)).toBe(true);
  });
});
