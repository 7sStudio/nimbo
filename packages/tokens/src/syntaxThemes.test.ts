// The syntax themes (syntaxThemes.ts): every colour of every theme reads at 4.5:1 on the surface code sits on, and a
// published colour that already does is kept exactly.
import { expect, it } from "vitest";

import { readable, syntaxRoles, syntaxThemes } from "./syntaxThemes.js";

it("moves a colour that falls short just past 4.5:1 and keeps one that reads", () => {
  // VS Code Light+'s number green reads 4.18:1 on the result's tone; its blue keyword already reads
  expect(readable("#098658", "light")).not.toBe("#098658");
  expect(readable("#0000ff", "light")).toBe("#0000ff");
  // a translucent comment (Cursor's) becomes the solid colour it shows on the ground
  expect(readable("#e4e4e45e", "dark")).toMatch(/^#[0-9a-f]{6}$/u);
});

it("gives every role of every theme a solid colour in both schemes", () => {
  for (const theme of Object.values(syntaxThemes))
    if (theme !== null)
      for (const role of syntaxRoles) {
        expect(theme.light[role]).toMatch(/^#[0-9a-f]{6}$/u);
        expect(theme.dark[role]).toMatch(/^#[0-9a-f]{6}$/u);
        expect(readable(theme.light[role], "light")).toBe(theme.light[role]);
        expect(readable(theme.dark[role], "dark")).toBe(theme.dark[role]);
      }
});
