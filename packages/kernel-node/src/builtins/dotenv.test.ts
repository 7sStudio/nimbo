// Tests the .env parser and the public-name rule.
import { describe, expect, it } from "vitest";

import { isPublicEnvName, parseDotenv } from "./dotenv.js";

describe("parseDotenv", () => {
  it("reads KEY=value lines with an optional export, comments and blank lines", () => {
    const text =
      "# a comment\n\nA=1\nexport B = two words  \n  # indented comment\nC=\nnot a line\n";
    expect(parseDotenv(text)).toEqual({ A: "1", B: "two words", C: "" });
  });

  it("unescapes double-quoted values the way secrets.set writes them", () => {
    expect(parseDotenv('KEY="a \\"quoted\\" \\\\ path\\nnext line" # after')).toEqual({
      KEY: 'a "quoted" \\ path\nnext line',
    });
    expect(parseDotenv('KEY="keep \\t as is"')).toEqual({ KEY: "keep \\t as is" });
  });

  it("keeps single-quoted values literal and an unterminated quote as written", () => {
    expect(parseDotenv("A='x \\n $HOME'\nB=\"open\nC='open")).toEqual({
      A: "x \\n $HOME",
      B: '"open',
      C: "'open",
    });
  });

  it("tolerates CRLF line ends, lets a later line win and does no expansion", () => {
    expect(parseDotenv("A=1\r\nB=$A\r\nA=2\r\n")).toEqual({ A: "2", B: "$A" });
  });

  it("keeps a carriage return or a line separator inside a value, as secrets.set writes them raw", () => {
    const text = 'A="x\ry"\r\nB="\r"\nC=a\u2028b\nD="\u2029"';
    expect(parseDotenv(text)).toEqual({ A: "x\ry", B: "\r", C: "a\u2028b", D: "\u2029" });
  });
});

describe("isPublicEnvName", () => {
  it("is true for PUBLIC_* and *_PUBLISHABLE_KEY only", () => {
    const names = [
      "PUBLIC_URL",
      "STRIPE_PUBLISHABLE_KEY",
      "STRIPE_SECRET_KEY",
      "PUBLISHABLE_KEY",
      "MY_PUBLIC",
    ];
    expect(names.filter(isPublicEnvName)).toEqual(["PUBLIC_URL", "STRIPE_PUBLISHABLE_KEY"]);
  });
});
