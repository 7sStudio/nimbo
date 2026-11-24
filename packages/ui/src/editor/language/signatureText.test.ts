// The display-string lexer (signatureText.ts): each word takes the colour its place gives it.
import { expect, test } from "vitest";

import { signaturePieces } from "./signatureText.js";

const painted = (source: string) =>
  signaturePieces(source)
    .filter((piece) => piece.token !== undefined && piece.token !== "punc")
    .map((piece) => `${piece.text}:${piece.token ?? ""}`);

test("a method's signature: kind muted, owner a type, name a function, parameters, types", () => {
  expect(
    painted("(method) Greeter.greet(times?: number, cb: (x: string) => void): Promise<Res>"),
  ).toEqual([
    "(method) :cmt",
    "Greeter:typ",
    "greet:fn",
    "times:key",
    "number:typ",
    "cb:key",
    "x:key",
    "string:typ",
    "=>:kw",
    "void:typ",
    "Promise:typ",
    "Res:typ",
  ]);
});

test("a declaration: keyword, name, literal types and generics", () => {
  expect(painted('const mode: "test" | "live" = "test"')).toEqual([
    "const:kw",
    "mode:key",
    '"test":str',
    '"live":str',
    '"test":str',
  ]);
  expect(painted("from<T>(items: ArrayLike<T>): T[]")).toEqual([
    "from:fn",
    "T:typ",
    "items:key",
    "ArrayLike:typ",
    "T:typ",
    "T:typ",
  ]);
});
