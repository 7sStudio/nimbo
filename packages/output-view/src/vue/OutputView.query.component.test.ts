// Tests the query bar's entry in the viewer without an engine: no Query tool then (11-query §4). The bar itself, on the
// real engines, is tested in tests/output-view (query, results, filter, pins and history integration tests).
import { beforeAll, describe, expect, it } from "vitest";

import { mountOutput, valueOutput, warmUp } from "./fixtures/outputs.js";

// the viewer's first mount compiles and warms its modules: setup, not the test's time, as in the other OutputView tests
beforeAll(warmUp);

describe("without engines", () => {
  it("shows no Query tool", () => {
    const { wrapper } = mountOutput({ output: valueOutput("paymentIntent") });
    expect(wrapper.find('[aria-label="Query"]').exists()).toBe(false);
  });
});
