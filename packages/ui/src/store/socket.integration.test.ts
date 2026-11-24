// @vitest-environment node
// The page's session: the socket opened from the page's address as the ui client, the session read before its start
// (a bug in the start order), and stop closing it.
import { withDaemon } from "@jsnb/test-daemon";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import { openSocket, useSessionStore } from "./socket.js";

describe("the session", () => {
  it("opens the socket as the ui client, and closes it on stop", async () => {
    await withDaemon(async (daemon) => {
      setActivePinia(createPinia());
      const session = useSessionStore();
      expect(() => session.session()).toThrow("has not started");
      const client = openSocket({ url: daemon.url, token: daemon.token, notebook: "s.jsnb" });
      await session.start(client, "s.jsnb", () => undefined);
      expect((await client.workspace.info({})).root).toBeTypeOf("string");
      session.stop();
      expect(session.current).toBeNull();
      expect(client.status()).toBe("closed");
    });
  });
});
