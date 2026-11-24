// @vitest-environment node
// The Home page's stores on a real daemon: the start loads the list and the daemon's facts
// and follows what agents do; a busy kernel found at load gets its run's start; Refresh finds a file written by hand;
// the file actions go through, and a refused one is a toast; a stale token stops the start with its failure kept and
// no list read.
import { realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import { productVersion } from "@jsnb/core";
import type { Daemon } from "@jsnb/test-daemon";
import { withDaemon } from "@jsnb/test-daemon";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import { agentCreates, agentRunsForever } from "../store/fixtures/homeAgent.js";
import { whenTrue } from "../store/fixtures/page.js";
import { useHomeStore } from "../store/home.js";
import { useSessionStore } from "../store/socket.js";
import { useUiStore } from "../store/ui.js";
import { startHome } from "./mountHome.js";

const empty = `{\n  "version": 1,\n  "jsnb": "${productVersion}",\n  "cells": []\n}\n`;

/** Starts the Home page's stores on `daemon` with `token`; answers whether the start went through. */
function started(daemon: Daemon, token = daemon.token): Promise<boolean> {
  setActivePinia(createPinia());
  return startHome({ url: daemon.url, token, notebook: "", home: true });
}

describe("the Home page's start", () => {
  it("loads the list and the daemon's facts, a busy kernel with its run's start", async () => {
    await withDaemon(async (daemon, ws) => {
      const cell = await agentRunsForever(daemon, "a.jsnb");
      expect(await started(daemon)).toBe(true);
      const store = useHomeStore();
      expect(store.daemon).toMatchObject({ root: realpathSync(ws.dir), pid: process.pid });
      expect(store.notebooks.map((each) => each.path)).toEqual(["a.jsnb"]);
      const run = await daemon.client.cell.outputs({ notebook: "a.jsnb", cell });
      expect(store.kernels["a.jsnb"]).toEqual({
        state: "busy",
        busySince: run.execution?.startedAt,
      });
      useSessionStore().stop();
    });
  });

  it("follows the agents, and Refresh finds a file written by hand", async () => {
    await withDaemon(async (daemon, ws) => {
      await started(daemon);
      const store = useHomeStore();
      await agentCreates(daemon, "sub/b.jsnb");
      await whenTrue(() => store.notebooks.some((each) => each.path === "sub/b.jsnb" && each.open));
      await writeFile(ws.path("by-hand.jsnb"), empty);
      await store.refresh();
      expect(store.notebooks.map((each) => each.path)).toEqual(["by-hand.jsnb", "sub/b.jsnb"]);
      useSessionStore().stop();
    });
  });

  it("stops at a stale token, keeping its failure and reading no list", async () => {
    await withDaemon(async (daemon) => {
      expect(await started(daemon, "not-the-token")).toBe(false);
      expect(useSessionStore().failure).toMatchObject({ name: "Unauthorized" });
      expect(useHomeStore().loaded).toBe(false);
    });
  });
});

describe("the Home store's file actions", () => {
  it("create, open, close, rename and delete, and a refused rename is a toast", async () => {
    await withDaemon(async (daemon) => {
      await started(daemon);
      const store = useHomeStore();
      expect(await store.create("a.jsnb")).toBeDefined();
      expect(await store.create("b.jsnb")).toBeDefined();
      expect(await store.close("a.jsnb")).toEqual({});
      expect(await store.rename("a.jsnb", "b.jsnb")).toBeUndefined();
      expect(useUiStore().toasts.at(-1)?.title).toMatch(/exists/iu);
      expect(await store.rename("a.jsnb", "c.jsnb")).toEqual({});
      expect(await store.remove("c.jsnb")).toEqual({});
      expect(await store.open("b.jsnb")).toBeDefined();
      await whenTrue(() => store.notebooks.length === 1 && store.notebooks[0]?.path === "b.jsnb");
      useSessionStore().stop();
    });
  });
});
