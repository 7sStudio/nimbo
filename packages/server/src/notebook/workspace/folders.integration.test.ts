// Home's Open folder on a real daemon over real folders: workspace.listFolders lists folders only (a count
// of .jsnb files, never a file's name), resolves links and `..`, leaves hidden folders out unless the path names one,
// says which workspace opening a folder opens, and refuses in words what is not a readable folder; only behind the
// token, never through the unauthenticated /n/ routes. The daemon notes its folder in the user's recent folders.
// workspace.open refuses the open workspace and a folder that is not one before anything changes.
import { chmod, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";

import { startDaemon } from "../../fixtures/daemon.js";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { bodyOf, postRpc, rawHttp } from "../../fixtures/raw.js";
import { within } from "../../fixtures/folders.js";

/** The test's world: a workspace `home` with a notebook, and beside it `projects` holding folders of every kind. */
async function world(ws: Workspace) {
  const home = await within(ws, "home");
  await writeFile(home.path("first.jsnb"), '{ "version": 1, "cells": [] }\n');
  const projects = await within(ws, "projects");
  for (const name of ["alpha", "beta/.jsnb", "beta/inner", ".hidden/deep", "10-ten", "2-two"])
    await mkdir(projects.path(name), { recursive: true });
  for (const name of ["one.jsnb", "two.jsnb", "secret-notes.txt"])
    await writeFile(projects.path("alpha", name), "x");
  await writeFile(projects.path("plan.jsnb"), "x");
  await writeFile(projects.path("budget-2027.txt"), "x");
  await symlink(projects.path("alpha"), projects.path("linked-alpha"));
  await symlink(projects.path("loop"), projects.path("loop"));
  const daemon = await startDaemon(home, { userConfigDir: ws.path("config") });
  return { home, projects, daemon, real: (path: string) => realpath(path) };
}

const refusal = (reason: string) => ({ data: { name: "FolderRefused", data: { reason } } });

describe("workspace.listFolders", () => {
  it("lists the folders inside a folder, each with its notebooks counted, and never a file's name", async () => {
    await withWorkspace(async (ws) => {
      const { projects, daemon, real } = await world(ws);
      const listing = await daemon.client.workspace.listFolders({ path: projects.dir });
      expect(listing).toMatchObject({
        path: await real(projects.dir),
        parent: await real(ws.dir),
        notebooks: 1,
        current: false,
        more: 0,
      });
      expect(listing.workspace).toBe(listing.path);
      expect(listing.folders.map(({ name, notebooks }) => [name, notebooks])).toEqual([
        ["2-two", 0],
        ["10-ten", 0],
        ["alpha", 2],
        ["beta", 0],
        ["linked-alpha", 2],
      ]);
      const text = JSON.stringify(listing);
      for (const file of ["one.jsnb", "secret-notes", "plan.jsnb", "budget-2027", ".hidden"])
        expect(text).not.toContain(file);
    });
  });
});

describe("workspace.listFolders reads the path it is given", () => {
  it("normalises the path: `..`, a link, a path from the workspace folder, `~` and no path at all", async () => {
    await withWorkspace(async (ws) => {
      const { home, projects, daemon, real } = await world(ws);
      const { client } = daemon;
      const alpha = await real(projects.path("alpha"));
      expect(
        (await client.workspace.listFolders({ path: projects.path("beta", "..", "alpha") })).path,
      ).toBe(alpha);
      expect(
        (await client.workspace.listFolders({ path: projects.path("linked-alpha") })).path,
      ).toBe(alpha);
      expect((await client.workspace.listFolders({ path: "../projects/alpha" })).path).toBe(alpha);
      expect((await client.workspace.listFolders({ path: "~" })).path).toBe(await real(homedir()));
      const own = await client.workspace.listFolders({});
      expect(own).toMatchObject({ path: await real(home.dir), current: true, notebooks: 1 });
    });
  });

  it("says which workspace opening a folder opens: the nearest folder holding .jsnb/, else the folder", async () => {
    await withWorkspace(async (ws) => {
      const { home, projects, daemon, real } = await world(ws);
      const { client } = daemon;
      const inner = await client.workspace.listFolders({ path: projects.path("beta", "inner") });
      expect(inner.workspace).toBe(await real(projects.path("beta")));
      await mkdir(home.path("sub"));
      const sub = await client.workspace.listFolders({ path: home.path("sub") });
      expect(sub).toMatchObject({ workspace: await real(home.dir), current: true });
      // a hidden folder is listed when the path names it, never offered as a row
      const hidden = await client.workspace.listFolders({ path: projects.path(".hidden") });
      expect(hidden.folders.map((each) => each.name)).toEqual(["deep"]);
    });
  });
});

describe("workspace.listFolders refuses what is not a readable folder, in words", () => {
  it("refuses a missing path, a file, a loop, an unreadable folder and a NUL", async () => {
    await withWorkspace(async (ws) => {
      const { projects, daemon } = await world(ws);
      const list = (path: string) => daemon.client.workspace.listFolders({ path });
      await expect(list(projects.path("nowhere"))).rejects.toMatchObject({
        ...refusal("missing"),
        message: `There is no folder at ${projects.path("nowhere")}.`,
      });
      await expect(list(projects.path("plan.jsnb"))).rejects.toMatchObject(refusal("notFolder"));
      await expect(list(projects.path("loop"))).rejects.toMatchObject(refusal("loop"));
      await chmod(projects.path("10-ten"), 0o000);
      try {
        await expect(list(projects.path("10-ten"))).rejects.toMatchObject(refusal("unreadable"));
      } finally {
        await chmod(projects.path("10-ten"), 0o755);
      }
      await expect(list("a\0b")).rejects.toMatchObject({ code: -32602 });
    });
  });

  it("answers only behind the token, and never through the routes that need none", async () => {
    await withWorkspace(async (ws) => {
      const { daemon } = await world(ws);
      const { port } = daemon.server;
      const call = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "workspace.listFolders",
        params: { path: "/" },
      });
      expect((await postRpc(port, "wrong", call)).status).toBe(401);
      const route = await rawHttp(port, { method: "POST", path: "/n/first/rpc", body: call });
      expect(route.status).toBe(404);
      expect(route.body).not.toContain("folders");
      expect(bodyOf(await postRpc(port, daemon.token, call))).toMatchObject({
        result: { path: "/" },
      });
    });
  });
});

describe("the recent folders", () => {
  it("hold the daemon's own folder from its start, kept in the user's config folder", async () => {
    await withWorkspace(async (ws) => {
      const { home, daemon, real } = await world(ws);
      const { folders } = await daemon.client.workspace.recentFolders({});
      expect(folders).toMatchObject([{ path: await real(home.dir), exists: true, current: true }]);
    });
  });
});

describe("workspace.open refuses before anything changes", () => {
  it("refuses the workspace open here, a folder inside it, and what is not a folder", async () => {
    await withWorkspace(async (ws) => {
      const { home, projects, daemon } = await world(ws);
      const { client } = daemon;
      await mkdir(home.path("sub"));
      for (const path of [home.dir, home.path("sub")])
        await expect(client.workspace.open({ path })).rejects.toMatchObject({
          data: { name: "FolderOpenRefused", data: { reason: "current" } },
        });
      await expect(
        client.workspace.open({ path: projects.path("plan.jsnb") }),
      ).rejects.toMatchObject(refusal("notFolder"));
      // the daemon still serves its folder
      expect((await client.workspace.info({})).notebooks).toMatchObject([{ path: "first.jsnb" }]);
    });
  });

  it("refuses while an open notebook holds changes that cannot be saved, naming it, and closes nothing", async () => {
    await withWorkspace(async (ws) => {
      const { home, projects, daemon } = await world(ws);
      const { client } = daemon;
      // the conflict a save finds, as an external edit makes it with merging off
      await client.settings.set({ key: "files.mergeExternalChanges", value: false });
      await client.notebook.open({ path: "first.jsnb" });
      await writeFile(home.path("first.jsnb"), '{ "version": 1, "cells": [] }\n\n');
      await client.cell.add({ notebook: "first.jsnb", type: "markdown", source: "mine" });
      await daemon.events.until("notebook.conflict");
      await expect(client.workspace.open({ path: projects.path("alpha") })).rejects.toMatchObject({
        data: { name: "FolderOpenRefused", data: { reason: "unsaved", path: "first.jsnb" } },
      });
      expect((await client.workspace.info({})).notebooks).toMatchObject([
        { path: "first.jsnb", open: true },
      ]);
    });
  });
});
