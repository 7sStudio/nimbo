// Tests connectCdp and the CDP session against real inspectors: a session on a real kernel's inspector,
// as a second client, gets each of its concurrent calls answered by its id, a call the inspector refuses rejected with
// InspectorFailed, and its pending and later calls rejected once it closed; a closed port is an InspectorFailed
// connect, not a hang. The paused state is followed in corpusDebugger.integration.test.ts, and the session closing
// itself when the kernel waits for its clients in every stop of nodeKernel.integration.test.ts.
import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import { withKernel } from "../fixtures/kernelWorld.js";
import { connectCdp } from "./inspector.js";

const options = { onPause: () => undefined, onInvalid: () => undefined };

/** A port that was free a moment ago and has nothing listening now. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return typeof address === "object" && address ? address.port : 0;
}

describe("a CDP session on a real kernel's inspector", () => {
  it("answers concurrent calls by id, and rejects a call the inspector refuses", async () => {
    await withKernel(async ({ kernel }) => {
      const cdp = await connectCdp(kernel.inspectorUrl() ?? "", options);
      const answers = await Promise.all([
        cdp.send("Runtime.evaluate", { expression: "6 * 7" }),
        cdp.send("Runtime.evaluate", { expression: "'ab'.repeat(2)" }),
      ]);
      expect(answers).toMatchObject([{ result: { value: 42 } }, { result: { value: "abab" } }]);
      await expect(cdp.send("Runtime.nothing")).rejects.toMatchObject({
        name: "InspectorFailed",
        data: { method: "Runtime.nothing", reason: "'Runtime.nothing' wasn't found" },
      });
      cdp.close();
    });
  });

  it("rejects its pending calls once it closed, and every call after", async () => {
    await withKernel(async ({ kernel }) => {
      const cdp = await connectCdp(kernel.inspectorUrl() ?? "", options);
      const never = { expression: "new Promise(() => {})", awaitPromise: true };
      const pending = cdp.send("Runtime.evaluate", never);
      cdp.close();
      await expect(pending).rejects.toMatchObject({ data: { reason: "the connection closed" } });
      await expect(cdp.send("Debugger.resume")).rejects.toMatchObject({
        name: "InspectorFailed",
        data: { method: "Debugger.resume", reason: "the connection closed" },
      });
    });
  });
});

describe("connectCdp where nothing answers", () => {
  it("rejects with InspectorFailed when no inspector answers at the URL", async () => {
    const url = `ws://127.0.0.1:${String(await closedPort())}/gone`;
    await expect(connectCdp(url, options)).rejects.toMatchObject({
      name: "InspectorFailed",
      data: { method: "connect", reason: `no inspector answers at ${url}` },
    });
  });

  it("rejects with InspectorFailed when the URL is no WebSocket URL", async () => {
    await expect(connectCdp("not a url", options)).rejects.toMatchObject({
      name: "InspectorFailed",
      data: { method: "connect", reason: "not a url is not a WebSocket URL" },
    });
  });
});
