// @vitest-environment node
// The page's start against a real daemon: the session, the hydrated notebook, the workspace and the settings in that
// order; a start the daemon refuses stops at once and keeps its failure for the page's banner, never a throw. And the full value of a retained output
// downloaded with the page's token for the viewer's "load the whole value".
import { withDaemon } from "@jsnb/test-daemon";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import { fullValueFetcher, fullValuePath } from "./fullValue.js";
import { useNotebookStore } from "./notebook.js";
import { useSessionStore } from "./socket.js";
import { useSettingsStore } from "./settings.js";
import { startPage, startSession } from "./start.js";
import { useUiStore } from "./ui.js";
import { useWorkspaceStore } from "./workspace.js";

describe("startPage", () => {
  it("starts the session, hydrates the notebook and loads the workspace and the settings", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "s.jsnb" });
      setActivePinia(createPinia());
      await startPage({ url: daemon.url, token: daemon.token, notebook: "s.jsnb" });
      expect(useNotebookStore().mirror.notebook?.path).toBe("s.jsnb");
      expect(useWorkspaceStore().info?.root).toBeTypeOf("string");
      expect(useSettingsStore().valueOf("ui.theme")).toBe("system");
      useSessionStore().stop();
    });
  });

  it("stops a refused start at once: closed, its failure kept, no session, no toast, nothing more loaded", async () => {
    await withDaemon(async (daemon) => {
      setActivePinia(createPinia());
      const started = await startPage({ url: daemon.url, token: "wrong", notebook: "s.jsnb" });
      const session = useSessionStore();
      expect(started).toBe(false);
      expect(session.current).toBeNull();
      expect(session.status).toBe("closed");
      expect(useNotebookStore().connection).toBe("closed");
      expect(Reflect.get(Object(session.failure), "name")).toBe("Unauthorized");
      expect(useUiStore().toasts).toEqual([]);
      expect(useWorkspaceStore().info).toBeNull();
      expect(useNotebookStore().mirror.notebook).toBeNull();
    });
  });
});

describe("startPage refused after the socket opened", () => {
  it("stops a start refused after the socket opened (a notebook that is gone) the same way, naming it", async () => {
    await withDaemon(async (daemon) => {
      setActivePinia(createPinia());
      const started = await startPage({
        url: daemon.url,
        token: daemon.token,
        notebook: "gone.jsnb",
      });
      const session = useSessionStore();
      expect(started).toBe(false);
      expect(session.current).toBeNull();
      expect(session.status).toBe("closed");
      expect(Reflect.get(Object(session.failure), "name")).toBe("NotebookNotFound");
      expect(useNotebookStore().pageName).toBe("gone.jsnb");
      expect(useNotebookStore().started).toBe(false);
      expect(useUiStore().toasts).toEqual([]);
    });
  });
});

describe("the full value", () => {
  it("is the retained value of a run, downloaded with the page's token", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "f.jsnb" });
      const big = "Array.from({ length: 40000 }, (_, i) => ({ i, label: 'row ' + i }))";
      const added = await daemon.client.cell.add({
        notebook: "f.jsnb",
        type: "server",
        source: big,
        run: true,
      });
      const execution = added.cell.lastExecution?.id ?? "";
      const fetch = fullValueFetcher({ url: daemon.url, token: daemon.token });
      const blob = await fetch(
        `${daemon.url}${fullValuePath(execution, 0)}`,
        new AbortController().signal,
      );
      const value: unknown = JSON.parse(await blob.text());
      expect(Array.isArray(value) && value.length).toBe(40000);
      await expect(fetch("/elsewhere", new AbortController().signal)).rejects.toThrow(
        "not a full-value URL",
      );
    });
  });
});

describe("startSession", () => {
  it("hydrates the notebook for the output tab without loading the workspace", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "t.jsnb" });
      setActivePinia(createPinia());
      await startSession({ url: daemon.url, token: daemon.token, notebook: "t.jsnb" });
      expect(useNotebookStore().mirror.notebook?.path).toBe("t.jsnb");
      expect(useWorkspaceStore().info).toBeNull();
      useSessionStore().stop();
    });
  });
});
