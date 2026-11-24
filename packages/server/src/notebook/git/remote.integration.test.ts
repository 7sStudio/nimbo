// The remote commands against the real git and a local bare remote: fetch, publish, push, pull (fast-forward, merge,
// rebase as configured, conflict then abort), sync, the refusals (no upstream, detached HEAD, local changes without
// confirm, a rejected push), an unreachable remote failing at once with its URL's token redacted, one operation at a
// time, and cancel.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { expect, it } from "vitest";

import { startDaemon } from "../../fixtures/daemon.js";
import { isolateGit, makeRepo, pushFrom, sh, withRemote } from "../../fixtures/git.js";

isolateGit();

const head = (dir: string) => sh(dir, "rev-parse", "HEAD").trim();

it("fetches, pulls a fast-forward and a merge, pushes and syncs", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    await withRemote(ws.dir, async ({ other }) => {
      const { client, events } = await startDaemon(ws);
      await pushFrom(other, { "b.txt": "b\n" });
      await client.git.fetch({});
      const behind = await client.git.status({});
      expect(behind.repo?.branch).toMatchObject({ upstream: "origin/main", behind: 1, ahead: 0 });
      const ff = await client.git.pull({});
      expect(ff).toEqual({ strategy: "merge", result: "fastForward", conflicts: [] });
      expect(head(ws.dir)).toBe(head(other));
      expect(await client.git.pull({})).toMatchObject({ result: "upToDate" });

      await pushFrom(other, { "c.txt": "c\n" });
      await writeFile(ws.path("d.txt"), "d\n");
      sh(ws.dir, "add", "d.txt");
      sh(ws.dir, "commit", "-q", "-m", "mine");
      sh(ws.dir, "config", "pull.rebase", "false");
      const merged = await client.git.sync({});
      expect(merged).toEqual({
        pull: { strategy: "merge", result: "merged", conflicts: [] },
        pushed: true,
      });
      sh(other, "pull", "-q", "--no-rebase");
      expect(head(other)).toBe(head(ws.dir));
      expect(events.all().some((event) => event.type === "git.progress")).toBe(true);

      await writeFile(ws.path("e.txt"), "e\n");
      sh(ws.dir, "add", "e.txt");
      sh(ws.dir, "commit", "-q", "-m", "mine again");
      expect(await client.git.push({})).toEqual({ branch: "main", upstream: "origin/main" });
      expect(sh(other, "ls-remote", "origin", "main").split("\t")[0]).toBe(head(ws.dir));
    });
  });
});

it("pulls with the configured rebase, and stops on a conflict that abort undoes", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    await withRemote(ws.dir, async ({ other }) => {
      const { client } = await startDaemon(ws);
      await pushFrom(other, { "b.txt": "theirs\n" });
      await writeFile(ws.path("c.txt"), "mine\n");
      sh(ws.dir, "add", "c.txt");
      sh(ws.dir, "commit", "-q", "-m", "mine");
      sh(ws.dir, "config", "pull.rebase", "true");
      expect(await client.git.pull({})).toEqual({
        strategy: "rebase",
        result: "rebased",
        conflicts: [],
      });
      expect(sh(ws.dir, "rev-parse", "HEAD~1").trim()).toBe(head(other));

      await pushFrom(other, { "a.txt": "theirs\n" });
      await writeFile(ws.path("a.txt"), "mine\n");
      sh(ws.dir, "commit", "-q", "-am", "mine on a");
      const before = head(ws.dir);
      const stopped = await client.git.pull({ rebase: false });
      expect(stopped).toEqual({ strategy: "merge", result: "conflicts", conflicts: ["a.txt"] });
      const status = await client.git.status({});
      expect(status.repo?.state).toBe("merging");
      await expect(client.git.abort({})).rejects.toMatchObject({ data: { reason: "confirm" } });
      expect(await client.git.abort({ confirm: true })).toEqual({ aborted: "merge" });
      expect(head(ws.dir)).toBe(before);
      expect((await client.git.status({})).repo?.state).toBe("clean");
    });
  });
});

it("refuses what it cannot do safely: local changes, no upstream, detached HEAD, a rejected push", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    await withRemote(ws.dir, async ({ other }) => {
      const { client } = await startDaemon(ws);
      await writeFile(ws.path("a.txt"), "local\n");
      await expect(client.git.pull({})).rejects.toMatchObject({
        name: "GitFailed",
        data: { reason: "confirm" },
      });
      await pushFrom(other, { "a.txt": "theirs\n" });
      await expect(client.git.pull({ confirm: true })).rejects.toMatchObject({
        data: { reason: "localChanges", message: expect.stringContaining("a.txt") as unknown },
      });
      sh(ws.dir, "checkout", "-q", "--", "a.txt");
      await writeFile(ws.path("b.txt"), "b\n");
      sh(ws.dir, "add", "b.txt");
      sh(ws.dir, "commit", "-q", "-m", "mine");
      await expect(client.git.push({})).rejects.toMatchObject({ data: { reason: "rejected" } });

      sh(ws.dir, "switch", "-q", "-c", "topic");
      await expect(client.git.push({})).rejects.toMatchObject({ data: { reason: "noUpstream" } });
      expect(await client.git.publish({})).toEqual({ branch: "topic", upstream: "origin/topic" });
      expect(sh(ws.dir, "rev-parse", "--abbrev-ref", "topic@{u}").trim()).toBe("origin/topic");

      await expect(client.git.publish({ remote: "-x" })).rejects.toMatchObject({
        name: "InvalidParams",
      });
      sh(ws.dir, "switch", "-q", "--detach");
      await expect(client.git.pull({})).rejects.toMatchObject({ data: { reason: "detached" } });
    });
  });
});

it("fails fast on a remote it cannot reach, its URL's token redacted, never prompting", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    sh(ws.dir, "remote", "add", "origin", "https://user:s3cr3t-token@127.0.0.1:9/repo.git");
    sh(ws.dir, "remote", "add", "local", join(ws.dir, "missing.git"));
    const { client, events } = await startDaemon(ws);
    const started = Date.now();
    const failure: unknown = await client.git.fetch({ remote: "origin" }).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(failure).toMatchObject({ name: "GitFailed", data: { reason: "network" } });
    expect(JSON.stringify(failure)).not.toContain("s3cr3t");
    expect(JSON.stringify(events.all())).not.toContain("s3cr3t");
    await expect(client.git.fetch({ remote: "local" })).rejects.toMatchObject({
      data: { reason: "network" },
    });
    const { remotes } = await client.git.branches({});
    expect(remotes.find((remote) => remote.name === "origin")?.url).toBe(
      "https://***@127.0.0.1:9/repo.git",
    );
  });
});

it("fails an authentication the remote demands at once instead of prompting", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    // a credential helper that answers nothing, as a missing one does: git would then ask on the terminal
    const helper = ws.path("deny.sh");
    await writeFile(helper, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    sh(ws.dir, "config", "credential.helper", helper);
    const remote = ws.path("auth.sh");
    await writeFile(remote, "#!/bin/sh\necho 'fatal: Authentication failed' >&2\nexit 128\n", {
      mode: 0o755,
    });
    sh(ws.dir, "remote", "add", "origin", `ext::${remote}`);
    sh(ws.dir, "config", "protocol.ext.allow", "always");
    const { client } = await startDaemon(ws);
    await expect(client.git.fetch({})).rejects.toMatchObject({
      data: { reason: "auth", message: expect.stringContaining("credentials") as unknown },
    });
  });
});

it("runs one long operation at a time, answers busy, and cancels", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    // a remote whose transport never answers, so the fetch runs until it is cancelled
    const remote = ws.path("hang.sh");
    await writeFile(remote, "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
    sh(ws.dir, "remote", "add", "origin", `ext::${remote}`);
    sh(ws.dir, "config", "protocol.ext.allow", "always");
    sh(ws.dir, "config", "branch.main.remote", "origin");
    sh(ws.dir, "config", "branch.main.merge", "refs/heads/main");
    const { client } = await startDaemon(ws);
    const running = client.git.fetch({}).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(client.git.pull({})).rejects.toMatchObject({ data: { reason: "busy" } });
    await expect(client.git.stage({ paths: ["a.txt"] })).rejects.toMatchObject({
      data: { reason: "busy" },
    });
    expect(await client.git.cancel({})).toEqual({ cancelled: "fetch" });
    expect(await running).toMatchObject({ data: { reason: "cancelled" } });
    expect(await client.git.cancel({})).toEqual({ cancelled: null });
    await client.git.stage({ paths: ["a.txt"] });
  });
});
