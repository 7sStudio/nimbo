// Tests useSearch.ts: the counter, stepping with wrap-around, the error of a bad regex, the focus that hides what has
// no match until "show all", and a new query starting over at its first match.
import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";

import { useSearch } from "./useSearch.js";

const json = { customer: "cus_1", list: ["cus_2", "x"], other: 1 };

describe("useSearch", () => {
  it("counts, steps around the matches and folds the rest", async () => {
    const search = useSearch({ json: ref(json), timeZone: ref("UTC"), initial: "cus" });
    expect(search.counter.value).toBe("1 / 3");
    search.text.value = "cus_";
    await nextTick();
    expect(search.counter.value).toBe("1 / 2");
    expect(search.move(1)).toEqual(["list", 0]);
    expect(search.move(1)).toEqual(["customer"]);
    expect(search.move(-1)).toEqual(["list", 0]);
    expect(search.focus.value?.only).toBe(true);
    search.showAll.value = true;
    expect(search.focus.value?.only).toBe(false);
    expect(search.matches.value?.get("$.customer")).toHaveLength(1);
  });

  it("reports a bad regular expression and has nothing to step to", () => {
    const search = useSearch({ json: ref(json), timeZone: ref(undefined) });
    expect([search.counter.value, search.focus.value]).toEqual(["", undefined]);
    search.text.value = "/(/";
    expect(search.error.value).toMatch(/regular expression/i);
    expect(search.move(1)).toBeUndefined();
  });

  it("searches keys only when the scope says so", () => {
    const search = useSearch({ json: ref(json), timeZone: ref("UTC"), initial: "cus" });
    search.scope.value = "keys";
    expect(search.matches.value?.size).toBe(1);
  });
});
