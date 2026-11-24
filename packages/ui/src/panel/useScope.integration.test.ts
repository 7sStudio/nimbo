// @vitest-environment node
// The Variables panel's data on a real daemon and kernel: kernel.scope once the notebook is hydrated,
// again after a run settles, and the client realm's names from the daemon's record when its realm changes.
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";
import { effectScope, ref } from "vue";

import { startPage, whenTrue } from "../store/fixtures/page.js";
import type { Realm } from "./useScope.js";
import { useScope } from "./useScope.js";

const names = (scope: ReturnType<typeof useScope>["value"]) =>
  scope !== null && "bindings" in scope ? scope.bindings.map((each) => each.name) : [];

describe("useScope on a real daemon", () => {
  it("reads the server's scope after each run, and the client's on a switch", async () => {
    await withDaemon(async (daemon) => {
      const { store } = await startPage(daemon, "scope.jsnb", {}, false);
      const realm = ref<Realm>("server");
      const effects = effectScope();
      const scope = effects.run(() => useScope(store, realm));
      if (scope === undefined) throw new Error("no scope");
      await whenTrue(() => scope.value !== null);
      expect(names(scope.value)).toEqual([]);
      const cell = await store.add("server", undefined, "export const answer = 42");
      if (cell === undefined) throw new Error("no cell");
      await store.run(cell.id);
      await whenTrue(() => names(scope.value).includes("answer"));
      const answer =
        scope.value !== null && "bindings" in scope.value ? scope.value.bindings[0] : undefined;
      expect(answer).toMatchObject({ name: "answer", exported: true, definedBy: cell.id });
      // the client realm's names come from the daemon's record of the page's runs: none ran here
      realm.value = "client";
      await whenTrue(() => scope.value === null);
      await whenTrue(() => scope.value !== null);
      expect(scope.value).toEqual({ bindings: [] });
      effects.stop();
    });
  });
});
