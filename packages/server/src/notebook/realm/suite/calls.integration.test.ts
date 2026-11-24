// The bridge suite, 05-bridge §11 item 6 with §4.1 (real kernel, daemon and page): concurrent calls from one client cell
// resolve independently, a failing one leaving the others alone; a call that never answers is RpcTimeout after
// bridge.rpcTimeoutMs with the catalogue's message; the page applies the notebook's settings to each client run.
import { describe, expect, it } from "vitest";

import { bridgeSuite } from "../../../fixtures/bridge.js";
import { valueOf } from "../../../fixtures/notebook.js";

const { withBridge } = bridgeSuite();

describe("concurrent calls from one client cell", () => {
  it("resolve independently, in the order their server functions answer, a throw rejecting its own only", async () => {
    await withBridge(async ({ server, client, run }) => {
      await server(`const waiting = new Map<string, (tag: string) => void>();
export function wait(tag: string) {
  return new Promise<string>((resolve, reject) => {
    waiting.set(tag, (done) => (done === "bad" ? reject(new Error("bad tag")) : resolve(done)));
  });
}
export function release(tag: string) {
  waiting.get(tag)?.(tag);
  return tag;
}`);
      const concurrent = `const order: string[] = [];
const all = Promise.allSettled([
  wait("slow").then((tag) => order.push(tag)),
  wait("fast").then((tag) => order.push(tag)),
  wait("bad"),
  wait("mid").then((tag) => order.push(tag)),
]);
for (const tag of ["fast", "bad", "mid", "slow"]) await release(tag);
const settled = await all;
[order, settled.map((each) => each.status)]`;
      expect(valueOf(await run(await client(concurrent)))).toEqual([
        ["fast", "mid", "slow"],
        ["fulfilled", "fulfilled", "rejected", "fulfilled"],
      ]);
    });
  });
});

describe("a call that never answers", () => {
  it("is RpcTimeout after bridge.rpcTimeoutMs, and the page answers the next call", async () => {
    await withBridge(async ({ daemon, server, client, run }) => {
      await daemon.client.settings.set({ key: "bridge.rpcTimeoutMs", value: 400 });
      await server(
        "export function hang(n: number) { return new Promise(() => {}) }\nexport const one = () => 1",
      );
      const hung = await run(await client("await hang(7)"));
      expect(hung.error).toMatchObject({
        name: "RpcTimeout",
        message:
          "hang(7) did not answer within 0.4s. The server cell may be blocked; try kernel.interrupt.",
      });
      expect(valueOf(await run(await client("await one()")))).toBe(1);
    });
  });
});

describe("a client run's limits", () => {
  it("follow the notebook's settings, read again for every run", async () => {
    await withBridge(async ({ daemon, client, run }) => {
      const printing = await client('console.log("0123456789abcdefghij")\n"x".repeat(64)');
      await daemon.client.settings.set({ key: "outputs.maxStreamBytes", value: 16 });
      await daemon.client.settings.set({ key: "outputs.maxValueBytes", value: 32 });
      const cut = await run(printing);
      expect(cut.outputs).toContainEqual({
        kind: "stream",
        stream: "stdout",
        text: "0123456789abcdef",
      });
      expect(cut.outputs).toContainEqual(
        expect.objectContaining({ kind: "value", truncated: true }),
      );
      await daemon.client.settings.set({ key: "outputs.maxStreamBytes", value: 1_048_576 });
      const whole = await run(printing);
      expect(whole.outputs).toContainEqual({
        kind: "stream",
        stream: "stdout",
        text: "0123456789abcdefghij\n",
      });
    });
  });
});
