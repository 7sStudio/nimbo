// Tests the query bar's history walk on its own (no viewer mounted, no engine needed): ↑ recalls the newest query, then
// the one before, and ↓ empties the input past the newest. The mode each view's bar opens in, which
// needs the engines, is tested through the viewer on the real engines in tests/output-view (query.integration.test.ts).
import { describe, expect, it } from "vitest";
import { ref, shallowRef } from "vue";

import { barOf, recall } from "./queryActions.js";
import type { SqlTable } from "./useSqlTable.js";

/** A bar over two records on a tree, with no engines and a table nothing reads. */
function bar() {
  const table: SqlTable = {
    schema: shallowRef(undefined),
    ensure: () => Promise.resolve({ ok: false, error: { kind: "unavailable", message: "no SQL" } }),
    drop: () => Promise.resolve(),
  };
  return barOf({
    engines: ref({}),
    json: ref([{ a: 1 }, { a: 2 }]),
    view: ref("tree"),
    pin: undefined,
    filter: undefined,
    table,
    onPin: () => undefined,
  });
}

describe("history", () => {
  it("recalls the newest query with ↑, then the one before, and empties past the newest with ↓", () => {
    const tree = bar();
    tree.state.value = { ...tree.state.value, history: { jsonpath: ["$.b", "$.a"] } };
    const text = () => tree.state.value.text;
    recall(tree, 1);
    expect(text()).toBe("$.b");
    recall(tree, 1);
    expect(text()).toBe("$.a");
    recall(tree, 1);
    expect(text()).toBe("$.a");
    recall(tree, -1);
    recall(tree, -1);
    expect(text()).toBe("");
  });
});
