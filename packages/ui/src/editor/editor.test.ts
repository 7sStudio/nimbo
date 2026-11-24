// The editor's pure parts: the syntax error's place and underline, word and import-name
// completion, the minimal change an agent's edit makes, and leaving the document at its first or last line.
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { completionWords, importNamesOf, wordCompletion, wordsOf } from "./completion.js";
import { syntaxDiagnostic, syntaxPlace } from "./lint.js";
import { replaceWith } from "./setup.js";

describe("syntax errors", () => {
  it("reads a SyntaxError's first frame and nothing else", () => {
    const error = {
      name: "SyntaxError",
      message: "Unexpected token",
      raw: "",
      frames: [{ line: 2, col: 3 }],
    };
    expect(syntaxPlace(error)).toEqual({ line: 2, col: 3, message: "Unexpected token" });
    expect(syntaxPlace({ ...error, frames: [] })).toBeNull();
    expect(syntaxPlace({ ...error, name: "TypeError" })).toBeNull();
    expect(syntaxPlace(undefined)).toBeNull();
  });

  it("underlines the word at the place, one character at least, inside the document", () => {
    const doc = Text.of(["const x = ;", "foo bar"]);
    expect(syntaxDiagnostic(doc, { line: 2, col: 5, message: "m" })).toMatchObject({
      from: 16,
      to: 19,
      severity: "error",
    });
    expect(syntaxDiagnostic(doc, { line: 1, col: 11, message: "m" })).toMatchObject({
      from: 10,
      to: 11,
    });
    expect(syntaxDiagnostic(doc, { line: 9, col: 99, message: "m" })).toMatchObject({
      from: 18,
      to: 19,
    });
  });
});

describe("completion", () => {
  it("collects identifiers of three characters or more, and the names imports bring in", () => {
    expect(wordsOf(["const paymentIntent = stripe.create(ab)"])).toEqual([
      "const",
      "create",
      "paymentIntent",
      "stripe",
    ]);
    expect(
      importNamesOf([
        'import Stripe from "stripe";',
        'import { a, b as c } from "x"',
        'import * as d from "y"',
      ]),
    ).toEqual(["Stripe", "a", "c", "d"]);
  });

  it("offers the words for the word before the caret, never the word itself", async () => {
    const source = wordCompletion(() => completionWords(["paym paymentIntent"]));
    const state = EditorState.create({ doc: "paym" });
    const words = await source(new CompletionContext(state, 4, false));
    expect(words?.options.map((o) => [o.label, o.detail])).toEqual([["paymentIntent", "name"]]);
    expect(
      await source(new CompletionContext(EditorState.create({ doc: "a " }), 2, false)),
    ).toBeNull();
    const asked = await source(new CompletionContext(EditorState.create({ doc: "a " }), 2, true));
    expect(asked?.from).toBe(2);
  });
});

describe("completionWords", () => {
  it("says an import name as an import, once, before the notebook's other names", () => {
    expect(
      completionWords(['import Stripe from "stripe";\nconst stripe = new Stripe(key);']),
    ).toEqual([
      { label: "Stripe", detail: "import" },
      { label: "const", detail: "name" },
      { label: "from", detail: "name" },
      { label: "import", detail: "name" },
      { label: "key", detail: "name" },
      { label: "new", detail: "name" },
      { label: "stripe", detail: "name" },
    ]);
  });
});

describe("replaceWith", () => {
  it("changes only the middle that differs, and nothing when equal", () => {
    const state = EditorState.create({ doc: "const total = 1;" });
    expect(replaceWith(state, "const total = 1;")).toBeNull();
    expect(replaceWith(state, "const total = 22;")).toMatchObject({
      changes: { from: 14, to: 15, insert: "22" },
    });
    expect(replaceWith(state, "x")).toMatchObject({ changes: { from: 0, to: 16, insert: "x" } });
  });
});
