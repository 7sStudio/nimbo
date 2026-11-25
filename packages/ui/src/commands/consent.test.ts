// The yes of a destructive page command: only a token a dialog made, once; key bindings lose every yes-like argument.
import { expect, it } from "vitest";

import { bindingArgs, consent, consented } from "./consent.js";

it("takes only a token a dialog made, once, and strips yes-like arguments from key bindings", () => {
  expect(consented({ confirm: true })).toBe(false);
  expect(consented({ confirmed: true })).toBe(false);
  expect(consented({ consent: "guessed" })).toBe(false);
  const token = consent();
  expect(consented({ consent: token })).toBe(true);
  expect(consented({ consent: token })).toBe(false);
  expect(
    bindingArgs({ index: 0, confirm: true, confirmed: true, consent: "x", force: true, yes: true }),
  ).toEqual({ index: 0 });
});
