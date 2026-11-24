// @vitest-environment node
// What a view reads on open, on a real daemon: nothing while the page has no session, the read once one has started,
// at once for a view opened later; and the Explorer's read, workspace.info again, which finds a notebook an agent
// created since the page loaded and keeps the last answer when the read fails.
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";
import { effectScope } from "vue";

import { agentCreates } from "../store/fixtures/homeAgent.js";
import { startPage, whenTrue } from "../store/fixtures/page.js";
import { useWorkspaceStore } from "../store/workspace.js";
import { whenStarted } from "./whenStarted.js";

const notebook = "explorer.jsnb";

describe("whenStarted on a real daemon", () => {
  it("waits for a session before the read, and reads at once when one has started", async () => {
    await withDaemon(async (daemon) => {
      const { session, store } = await startPage(daemon, notebook);
      session.stop();
      const reads: string[] = [];
      const effects = effectScope();
      effects.run(() => {
        whenStarted(store, () => reads.push("open before"));
      });
      expect([store.started, reads]).toEqual([false, []]);
      await session.start(daemon.socket({ client: "ui" }), notebook, () => undefined);
      await whenTrue(() => reads.length === 1);
      effects.run(() => {
        whenStarted(store, () => reads.push("opened after"));
      });
      expect(reads).toEqual(["open before", "opened after"]);
      effects.stop();
      session.stop();
    });
  });
});

describe("the Explorer's read on a real daemon", () => {
  it("lists a notebook an agent created since the page loaded, and keeps the list when the read fails", async () => {
    await withDaemon(async (daemon) => {
      const { client, session } = await startPage(daemon, notebook);
      const workspace = useWorkspaceStore();
      await workspace.start();
      const paths = () => workspace.info?.notebooks.map((each) => each.path);
      expect(paths()).toEqual([notebook]);
      await agentCreates(daemon, "sub/by-agent.jsnb");
      await workspace.refreshInfo();
      expect(paths()).toEqual([notebook, "sub/by-agent.jsnb"]);
      // the socket is gone: the read fails, and the Explorer keeps what it last listed
      client.close();
      await workspace.refreshInfo();
      expect(paths()).toEqual([notebook, "sub/by-agent.jsnb"]);
      session.stop();
    });
  });
});
