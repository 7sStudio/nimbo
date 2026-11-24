// The workspace store's package events: the banner shows the run whose progress came last, and only that run's
// packages.done takes it down; another run's end (a queued run cancelled) leaves it up.
import { EventEnvelope } from "@jsnb/core";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import { useWorkspaceStore } from "./workspace.js";

const event = (type: string, data: unknown) =>
  EventEnvelope.parse({ notebook: "", seq: 1, ts: "2026-11-11T10:00:00.000Z", type, data });

describe("the workspace store's package events", () => {
  it("keeps the run shown when another run ends, and takes it down when it ends", () => {
    setActivePinia(createPinia());
    const workspace = useWorkspaceStore();
    workspace.onEvent(
      event("packages.progress", { names: ["a"], line: "fetching", action: "add" }),
    );
    expect(workspace.installing).toEqual({ names: ["a"], lines: ["fetching"], action: "add" });
    workspace.onEvent(
      event("packages.done", { names: ["b"], ok: false, error: "x", action: "remove" }),
    );
    expect(workspace.installing?.names).toEqual(["a"]);
    workspace.onEvent(event("packages.done", { names: ["a"], ok: true, action: "remove" }));
    expect(workspace.installing?.names).toEqual(["a"]); // the same names, another action: not the run shown
    workspace.onEvent(event("packages.done", { names: ["a"], ok: true, action: "add" }));
    expect(workspace.installing).toBeNull();
  });
});
