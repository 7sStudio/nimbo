// /feedback/ (the page's feedback mode): entries saved with their screenshots in the workspace's .jsnb/feedback/, listed
// newest first, marked done and deleted with their files; the bearer header only, and no screenshot name that leaves the
// folder; feedback.list and feedback.update read and change the same notes.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { withDaemon } from "../fixtures/daemon.js";
import { bodyOf, pageCookie, rawHttp } from "../fixtures/raw.js";

// a 1 × 1 transparent PNG
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const input = (text: string) => ({
  text,
  selector: '[data-testid="run-all"]',
  components: ["App", "TopBar"],
  element: { tag: "button", text: "Run all", html: "<button>Run all</button>", rect },
  page: {
    kind: "notebook",
    path: "/ui/a",
    notebook: "a.jsnb",
    title: "a",
    viewport: { width: 1512, height: 982, dpr: 2 },
    theme: "light",
  },
  app: { version: "0.0.0", commit: "abc1234" },
  shots: { element: png, viewport: png },
});
const rect = { x: 1, y: 2, width: 30, height: 20 };

type Entry = {
  id: string;
  status: string;
  text: string;
  app: { server: unknown };
  shots: Record<string, string>;
};

/** A request to the daemon with the bearer header and a JSON body. */
const caller = (port: number, token: string) => (method: string, path: string, body?: unknown) =>
  rawHttp(port, {
    method,
    path,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Call = ReturnType<typeof caller>;

const list = async (call: Call) =>
  bodyOf(await call("GET", "/feedback/")) as { dir: string; entries: Entry[] };

/** Two entries saved, the first one returned. */
async function saveTwo(call: Call): Promise<Entry> {
  const first = await call("POST", "/feedback/", input("too much padding"));
  expect(first.status).toBe(201);
  await call("POST", "/feedback/", input("  label wraps  "));
  return bodyOf(first) as Entry;
}

describe("/feedback/ entries", () => {
  it("saves entries with their screenshots and lists them newest first", async () => {
    await withDaemon(async (daemon) => {
      const call = caller(daemon.server.port, daemon.token);
      const one = await saveTwo(call);
      expect(one).toMatchObject({ status: "open", text: "too much padding" });
      expect(typeof one.app.server).toBe("string");
      const listed = await list(call);
      expect(listed.entries.map((entry) => entry.text)).toEqual([
        "label wraps",
        "too much padding",
      ]);
      const lines = (await readFile(join(listed.dir, "feedback.jsonl"), "utf8")).trim().split("\n");
      expect(lines).toHaveLength(2);
      const index = await readFile(join(listed.dir, "FEEDBACK.md"), "utf8");
      expect(index).toMatch(/^# UI feedback \(2 open, 0 done\)/u);
      const shot = await call("GET", `/feedback/shots/${one.shots.element ?? ""}`);
      expect([shot.status, shot.headers["content-type"]]).toEqual([200, "image/png"]);
      expect(Buffer.from(shot.bytes).toString("base64")).toBe(png);
    });
  });

  it("marks an entry done, edits its text and deletes it with its screenshots", async () => {
    await withDaemon(async (daemon) => {
      const call = caller(daemon.server.port, daemon.token);
      const one = await saveTwo(call);
      const done = await call("PATCH", `/feedback/${one.id}`, { status: "done" });
      expect(bodyOf(done)).toMatchObject({ id: one.id, status: "done" });
      const edited = await call("PATCH", `/feedback/${one.id}`, { text: "less padding" });
      expect(bodyOf(edited)).toMatchObject({ status: "done", text: "less padding" });
      expect((await call("DELETE", `/feedback/${one.id}`)).status).toBe(204);
      expect((await call("DELETE", `/feedback/${one.id}`)).status).toBe(404);
      const left = await list(call);
      expect(left.entries.map((entry) => entry.text)).toEqual(["label wraps"]);
      const files = await readdir(left.dir);
      expect(files.filter((name) => name.startsWith(one.id))).toEqual([]);
      expect(files.filter((name) => name.endsWith(".png"))).toHaveLength(2);
    });
  });
});

describe("/feedback/<id>/shots, the screenshots sent after the note", () => {
  it("attaches them to the right entry once, however often it is repeated", async () => {
    await withDaemon(async (daemon) => {
      const call = caller(daemon.server.port, daemon.token);
      const bare = bodyOf(
        await call("POST", "/feedback/", { ...input("no shots yet"), shots: {} }),
      ) as Entry;
      const other = await call("POST", "/feedback/", input("other"));
      expect(bare.shots).toEqual({});
      for (const shots of [{ element: png }, { element: png, viewport: png }]) {
        const put = await call("PUT", `/feedback/${bare.id}/shots`, shots);
        expect(put.status).toBe(200);
      }
      const listed = await list(call);
      expect(listed.entries).toHaveLength(2);
      const entry = listed.entries.find((each) => each.id === bare.id);
      expect(entry?.shots).toEqual({
        element: `${bare.id}-element.png`,
        viewport: `${bare.id}-viewport.png`,
      });
      const lines = (await readFile(join(listed.dir, "feedback.jsonl"), "utf8")).trim().split("\n");
      expect(lines).toHaveLength(2);
      const files = await readdir(listed.dir);
      expect(files.filter((name) => name.endsWith(".png"))).toHaveLength(4);
      expect((await call("PUT", `/feedback/${bare.id}/shots`, { element: "../x" })).status).toBe(
        400,
      );
      expect((await call("GET", `/feedback/${bare.id}/shots`)).status).toBe(405);
      expect((await call("DELETE", `/feedback/${bare.id}`)).status).toBe(204);
      const gone = await call("PUT", `/feedback/${bare.id}/shots`, { element: png });
      expect(gone.status).toBe(404);
      const left = await readdir(listed.dir);
      expect(left.filter((name) => name.startsWith(bare.id))).toEqual([]);
      expect((bodyOf(other) as Entry).shots.element).toBeDefined();
    });
  });
});

describe("feedback.list and feedback.update, the agent's side of the same notes", () => {
  it("lists the open notes with absolute screenshot paths, marks one done for the page too", async () => {
    await withDaemon(async (daemon) => {
      const call = caller(daemon.server.port, daemon.token);
      const one = await saveTwo(call);
      const open = await daemon.client.feedback.list({});
      expect(open.notes.map((note) => note.text)).toEqual(["label wraps", "too much padding"]);
      const first = open.notes[1];
      expect(first?.where).toBe("a.jsnb · App > TopBar");
      expect(first?.shots.element).toBe(join(open.dir, one.shots.element ?? ""));
      expect(first?.element).toBeUndefined();
      const { note } = await daemon.client.feedback.update({ id: one.id, status: "done" });
      expect(note.status).toBe("done");
      // the page's endpoint and FEEDBACK.md see the change at once
      expect((await list(call)).entries.find((entry) => entry.id === one.id)?.status).toBe("done");
      expect(await readFile(join(open.dir, "FEEDBACK.md"), "utf8")).toMatch(/\(1 open, 1 done\)/u);
      expect((await daemon.client.feedback.list({})).notes.map((n) => n.text)).toEqual([
        "label wraps",
      ]);
      const all = await daemon.client.feedback.list({ status: "all", full: true });
      expect(all.notes[1]?.element).toMatchObject({
        tag: "button",
        html: "<button>Run all</button>",
      });
      await expect(
        daemon.client.feedback.update({ id: "nope", status: "done" }),
      ).rejects.toMatchObject({
        name: "InvalidParams",
      });
      await expect(daemon.client.feedback.update({ id: one.id })).rejects.toMatchObject({
        name: "InvalidParams",
      });
    });
  });
});

describe("/feedback/ refusals", () => {
  it("takes the bearer header only", async () => {
    await withDaemon(async (daemon) => {
      const { port, token } = daemon.server;
      const cookie = await pageCookie(port, token);
      expect((await rawHttp(port, { path: "/feedback/" })).status).toBe(401);
      expect((await rawHttp(port, { path: "/feedback/", headers: { cookie } })).status).toBe(401);
    });
  });

  it("refuses a body that is no entry and a name that leaves the folder", async () => {
    await withDaemon(async (daemon) => {
      const call = caller(daemon.server.port, daemon.token);
      const post = async (body: unknown) => (await call("POST", "/feedback/", body)).status;
      expect(
        (
          await rawHttp(daemon.server.port, {
            method: "POST",
            path: "/feedback/",
            headers: { authorization: `Bearer ${daemon.token}` },
            body: "{",
          })
        ).status,
      ).toBe(400);
      expect(await post({ ...input(" "), text: " " })).toBe(400);
      expect(await post({ ...input("x"), shots: { element: "../x" } })).toBe(400);
      for (const path of [
        "/feedback/shots/..%2Fsettings.json",
        "/feedback/shots/settings.json",
        "/feedback/nope",
      ])
        expect([path, (await call("GET", path)).status]).toEqual([path, 404]);
      const patch = await call("PATCH", "/feedback/20261115T131500Z-a1b2c3", { status: "gone" });
      expect(patch.status).toBe(400);
    });
  });
});
