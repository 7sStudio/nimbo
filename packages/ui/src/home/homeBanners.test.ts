// The Home page's banners: a stale token, a socket closed for good or a refused start, and a reconnect
// that is taking long; nothing while the socket is live.
import { describe, expect, it } from "vitest";

import { homeBanners } from "./homeBanners.js";

const live = {
  failure: null,
  stopped: false,
  connection: "live",
  reconnectingLong: false,
} as const;

describe("homeBanners", () => {
  it("says nothing while live, or while a reconnect is still short", () => {
    expect(homeBanners(live)).toEqual([]);
    expect(homeBanners({ ...live, connection: "reconnecting" })).toEqual([]);
  });

  it("names a stale token, a closed socket and a refused start, as alerts that say to open Home again", () => {
    const [stale] = homeBanners({ ...live, failure: "Unauthorized", stopped: true });
    expect(stale).toMatchObject({ id: "notConnected", tone: "error", title: "Not authorized" });
    expect(stale?.text).toContain("nimbo open.");
    expect(homeBanners({ ...live, connection: "closed" })[0]?.title).toBe("Disconnected");
    const refused = homeBanners({ ...live, failure: "DaemonStopping", stopped: true })[0];
    expect(refused?.text).toContain("(DaemonStopping)");
  });

  it("says a long reconnect may need nimbo open", () => {
    const [long] = homeBanners({ ...live, connection: "reconnecting", reconnectingLong: true });
    expect(long).toMatchObject({ id: "reconnecting", tone: "warn", title: "Still reconnecting" });
    expect(long?.text).toContain("open the Home page again with nimbo open.");
  });
});
