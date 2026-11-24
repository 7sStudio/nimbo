// The syntax colors of a token kind (theme.css's tokens): `text` reads in the foreground.
import type { TokenKind } from "../../model/leaf.js";

export const tokenColor: Readonly<Record<TokenKind, string>> = {
  key: "ov:text-key",
  str: "ov:text-str",
  num: "ov:text-num",
  bool: "ov:text-bool",
  nul: "ov:text-nul",
  typ: "ov:text-typ",
  fn: "ov:text-fn",
  punc: "ov:text-punc",
  text: "ov:text-fg",
};
