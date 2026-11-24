// Which banners a state calls for, and their order.
import { describe, expect, it } from "vitest";

import type { BannerFacts } from "./bannerList.js";
import { bannersOf } from "./bannerList.js";

const calm: BannerFacts = {
  kernelExit: null,
  save: "saved",
  saveError: null,
  connection: "live",
  pageAttached: true,
  ownAttach: "attached",
  attachError: null,
  failure: null,
  stopped: false,
  notebook: "demo",
  reconnectingLong: false,
  closed: false,
  installing: null,
};
const ids = (facts: Partial<BannerFacts>) =>
  bannersOf({ ...calm, ...facts }).map((banner) => banner.id);

describe("bannersOf", () => {
  it("shows nothing for a calm notebook", () => {
    expect(ids({})).toEqual([]);
  });

  it("keeps the banners' fixed order", () => {
    expect(
      ids({
        kernelExit: "",
        save: "failed",
        pageAttached: false,
        installing: { names: ["a"], line: null, action: "add" },
      }),
    ).toEqual(["kernelExited", "saveFailed", "noPage", "installing"]);
    expect(ids({ save: "conflict", connection: "viewOnly", pageAttached: false })).toEqual([
      "conflict",
      "viewOnly",
    ]);
  });
});

describe("bannersOf's words", () => {
  it("names the exit, the save error and the install's last line", () => {
    const [exited, failed, installing] = bannersOf({
      ...calm,
      kernelExit: "signal SIGKILL",
      save: "failed",
      saveError: "EACCES",
      installing: { names: ["a", "b"], line: "fetching", action: "add" },
    });
    expect(exited?.text).toBe("The server realm stopped with signal SIGKILL.");
    expect(failed?.text).toBe("EACCES");
    expect(installing).toMatchObject({
      title: "Installing",
      text: "a b",
      detail: "fetching",
      actions: [{ label: "Cancel", command: "ui.packages.cancel" }],
    });
    // a removal says so, with the same Cancel
    const [removing] = bannersOf({
      ...calm,
      installing: { names: ["a"], line: null, action: "remove" },
    });
    expect(removing).toMatchObject({ title: "Removing", text: "a" });
    expect(bannersOf({ ...calm, kernelExit: "", save: "failed" }).map((b) => b.text)).toEqual([
      "The server realm stopped.",
      "The notebook could not be written to disk.",
    ]);
  });

  it("says nothing about a missing page while the socket is away", () => {
    expect(ids({ connection: "reconnecting", pageAttached: false })).toEqual([]);
  });
});

describe("bannersOf, this tab's own state", () => {
  it("waits for this tab's own attach before saying no page is attached, and names a failed one", () => {
    expect(ids({ pageAttached: false, ownAttach: "pending" })).toEqual([]);
    const [failed] = bannersOf({
      ...calm,
      pageAttached: false,
      ownAttach: "failed",
      attachError: "the kernel is gone",
    });
    expect(failed).toMatchObject({
      id: "noPage",
      detail: "This tab could not attach: the kernel is gone",
    });
  });

  it("puts a closed connection first, naming a stale token", () => {
    const [stale] = bannersOf({
      ...calm,
      connection: "closed",
      failure: "Unauthorized",
      kernelExit: "",
    });
    expect(stale).toMatchObject({ id: "notConnected", title: "Not authorized" });
    expect(bannersOf({ ...calm, connection: "closed" })[0]?.title).toBe("Disconnected");
  });

  it("shows a start that stopped on a live socket, naming the notebook and what to do", () => {
    const [missing] = bannersOf({ ...calm, stopped: true, failure: "NotebookNotFound" });
    expect(missing).toMatchObject({ id: "notConnected", title: "Notebook not open" });
    expect(missing?.text).toContain("demo is closed");
    expect(missing?.actions).toEqual([{ label: "Home", command: "ui.home.open", primary: true }]);
    const [other] = bannersOf({ ...calm, stopped: true, failure: "WorkspaceMissing" });
    expect(other?.title).toBe("Could not open the notebook");
    expect(other?.text).toContain("WorkspaceMissing");
  });

  it("says what to do once a reconnect takes long, and only while reconnecting", () => {
    expect(ids({ connection: "reconnecting", reconnectingLong: true })).toEqual(["reconnecting"]);
    expect(ids({ connection: "reconnecting", reconnectingLong: false })).toEqual([]);
    expect(ids({ connection: "live", reconnectingLong: true })).toEqual([]);
  });
});

describe("a notebook another client closed", () => {
  it("says a notebook another client closed, with no banner about its kernel or its page", () => {
    const banners = bannersOf({ ...calm, closed: true, pageAttached: false, kernelExit: "" });
    expect(banners.map((banner) => banner.id)).toEqual(["notebookClosed"]);
    expect(banners[0]?.actions.map((action) => action.command)).toEqual(["ui.home.open"]);
  });

  it("promises to follow the reopen only while the socket is live: after nimbo stop the daemon may be gone", () => {
    const live = bannersOf({ ...calm, closed: true });
    expect(live[0]?.text).toContain("This tab follows it");
    for (const connection of ["reconnecting", "closed"] as const) {
      const lost = bannersOf({ ...calm, closed: true, connection }).find(
        (banner) => banner.id === "notebookClosed",
      );
      expect(lost?.text).toContain("no longer answers");
      expect(lost?.text).not.toContain("follows");
    }
  });
});
