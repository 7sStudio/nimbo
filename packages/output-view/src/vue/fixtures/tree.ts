// The payment intent the tree tests render (model/fixtures/values.ts), and readers and keys of the rendered tree.
import type { DOMWrapper, VueWrapper } from "@vue/test-utils";

import { valueCases } from "../../model/fixtures/values.js";

export const intent = valueCases.find((entry) => entry.name === "paymentIntent")?.json;

/** Presses `name` on the tree. */
export const key = (
  wrapper: VueWrapper,
  name: string,
  init: KeyboardEventInit = {},
): Promise<void> => wrapper.get('[role="tree"]').trigger("keydown", { key: name, ...init });

/** The row the tree's aria-activedescendant names. */
export function activeRow(wrapper: VueWrapper): Omit<DOMWrapper<Element>, "exists"> {
  const id = wrapper.get('[role="tree"]').attributes("aria-activedescendant") ?? "";
  return wrapper.get(`#${CSS.escape(id)}`);
}
