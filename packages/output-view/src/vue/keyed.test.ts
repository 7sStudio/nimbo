// Tests keyed(): the start value, a set value kept while the source stays, and a new source starting over.
import { describe, expect, it } from "vitest";
import { ref } from "vue";

import { keyed } from "./keyed.js";

describe("keyed", () => {
  it("starts from the source, keeps what is set, and starts over when the source changes", () => {
    const source = ref(2);
    const state = keyed(
      () => source.value,
      (from) => from * 10,
    );
    expect(state.value).toBe(20);
    state.value = 7;
    expect(state.value).toBe(7);
    source.value = 3;
    expect(state.value).toBe(30);
    source.value = 2;
    expect(state.value).toBe(20);
  });
});
