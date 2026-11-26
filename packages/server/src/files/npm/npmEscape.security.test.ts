// /npm/ reads nothing outside the workspace: a package subpath segment that
// decodes to `..` with separators of its own is a bare 404 before esbuild sees it, and a package whose file links out
// of the package folder is refused 500 with nothing cached; the outside file's content never reaches an answer.
import { existsSync } from "node:fs";
import { symlink, writeFile } from "node:fs/promises";

import { startDaemon } from "../../fixtures/daemon.js";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { within } from "../../fixtures/folders.js";
import { writeFiles } from "../../fixtures/packages.js";
import { rawHttp } from "../../fixtures/raw.js";

const fakepkg = {
  "node_modules/fakepkg/package.json": '{"name":"fakepkg","version":"1.0.0","main":"index.js"}\n',
  "node_modules/fakepkg/index.js": "export const inside = 1;\n",
};

describe("/npm/<package>/<a segment that climbs out>", () => {
  it("is a bare 404, and a file linked out of the package 500, nothing outside read or cached", async () => {
    await withWorkspace(async (ws) => {
      await writeFile(ws.path("secret.json"), '{"apiKey":"outside-the-workspace"}\n');
      const work = await within(ws, "work");
      await writeFiles(work, fakepkg);
      await symlink(ws.path("secret.json"), work.path("node_modules/fakepkg/data.json"));
      const daemon = await startDaemon(work);
      const get = (path: string) =>
        rawHttp(daemon.server.port, { path, headers: { authorization: `Bearer ${daemon.token}` } });
      for (const path of [
        "/npm/fakepkg/..%2F..%2F..%2Fsecret.json",
        "/npm/fakepkg/a%2F..%2F..%2F..%2F..%2Fsecret.json",
        "/npm/fakepkg/..%5C..%5C..%5Csecret.json",
      ]) {
        const answer = await get(path);
        expect([path, answer.status, answer.body]).toEqual([path, 404, ""]);
      }
      const linked = await get("/npm/fakepkg/data.json");
      expect([linked.status, linked.body.includes("outside-the-workspace")]).toEqual([500, false]);
      expect(linked.body).toContain("outside the package");
      expect(existsSync(work.path(".jsnb/cache/npm/fakepkg@1.0.0/@data.json.js"))).toBe(false);
      expect((await get("/npm/fakepkg")).status).toBe(200);
      await daemon.stop();
    });
  });
});
