// /npm/ through the daemon: a package bundled for the browser with its own bare imports external as
// /npm/<dep>, cached per version under .jsnb/cache/npm/, a subpath and a scoped name; a workspace file transformed
// with its imports rewritten; a missing package and a failed build as JSON-RPC bodies naming the spec, a build that
// fails tried again on the next request, a path the path rule refuses a bare 404; the page credentials.
import { readFile, rm, symlink } from "node:fs/promises";

import { withDaemon } from "../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { demoPackages, writeFiles } from "../../fixtures/packages.js";
import { bodyOf, pageCookie, rawHttp } from "../../fixtures/raw.js";

const prices = {
  "lib/prices.ts":
    'import { lib } from "@demo/lib";\nimport { tax } from "./util.ts";\nexport const price: number = lib() * tax;\n',
  "lib/util.ts": "export const tax: number = 2;\n",
};

describe("/npm/<package>", () => {
  it("bundles a package once per version, its bare imports left as /npm/ ones, a subpath and a scoped name", async () => {
    await withDaemon(async (daemon, ws) => {
      await writeFiles(ws, demoPackages);
      const get = (path: string) =>
        rawHttp(daemon.server.port, { path, headers: { authorization: `Bearer ${daemon.token}` } });
      const lib = await get("/npm/@demo/lib");
      expect(lib.status).toBe(200);
      expect(lib.headers["content-type"]).toBe("text/javascript; charset=utf-8");
      expect(lib.body).toContain('from "/npm/dep-esm"');
      expect(lib.body).toContain("var local = 1");
      const cache = ws.path(".jsnb/cache/npm/@demo/lib@1.2.3");
      expect(await readFile(`${cache}/index.js`, "utf8")).toBe(lib.body);
      expect(JSON.parse(await readFile(`${cache}/meta.json`, "utf8"))).toMatchObject({
        version: "1.2.3",
      });
      expect((await get("/npm/@demo/lib")).body).toBe(lib.body);
      expect((await get("/npm/@demo/lib/sub")).body).toContain('"sub"');
      expect((await get("/npm/cjs-dep")).body).toContain("exports.value = 7");
    });
  });
});

// Vue's layout as published: `exports` gives the runtime alone, `dist/*` holds the full build that adds the compiler.
const vueFiles = (withFull: boolean) => ({
  "node_modules/vue/package.json": `${JSON.stringify({
    name: "vue",
    version: withFull ? "3.5.0" : "2.7.0",
    exports: {
      ".": { import: { default: "./dist/vue.runtime.esm-bundler.js" } },
      "./dist/*": "./dist/*",
    },
  })}\n`,
  "node_modules/vue/dist/vue.runtime.esm-bundler.js":
    'export const build = "runtime";\nexport const options = __VUE_OPTIONS_API__;\n',
  ...(withFull
    ? {
        "node_modules/vue/dist/vue.esm-bundler.js":
          'export const build = "full";\nexport const flags = [__VUE_OPTIONS_API__, __VUE_PROD_DEVTOOLS__, __VUE_PROD_HYDRATION_MISMATCH_DETAILS__];\n',
      }
    : {}),
});

describe("/npm/vue", () => {
  it("is Vue's full build, with its compile-time flags defined; a version without one keeps its own entry", async () => {
    await withDaemon(async (daemon, ws) => {
      const get = async (path: string) =>
        (
          await rawHttp(daemon.server.port, {
            path,
            headers: { authorization: `Bearer ${daemon.token}` },
          })
        ).body;
      await writeFiles(ws, vueFiles(true));
      const full = await get("/npm/vue");
      expect(full).toContain('"full"');
      expect(full).toContain("[true, false, false]");
      await writeFiles(ws, vueFiles(false));
      await rm(ws.path("node_modules/vue/dist/vue.esm-bundler.js"));
      const runtime = await get("/npm/vue");
      expect(runtime).toContain('"runtime"');
      expect(runtime).not.toContain("__VUE_OPTIONS_API__");
    });
  });
});

describe("/npm/<workspace file>", () => {
  it("serves the file transformed, its imports rewritten to /npm/ paths", async () => {
    await withDaemon(async (daemon, ws) => {
      await writeFiles(ws, { ...demoPackages, ...prices });
      const answer = await rawHttp(daemon.server.port, {
        path: "/npm/.%2Flib%2Fprices.ts",
        headers: {
          cookie: await pageCookie(daemon.server.port, daemon.token),
          "sec-fetch-site": "same-origin",
        },
      });
      expect(answer.status).toBe(200);
      expect(answer.body).toContain('from "/npm/@demo/lib"');
      expect(answer.body).toContain('from "/npm/.%2Flib%2Futil.ts"');
      expect(answer.body).not.toContain(": number");
    });
  });
});

describe("/npm/'s refusals", () => {
  it("name a missing package in a JSON-RPC body; a path the rule refuses is a bare 404; 401 without credentials", async () => {
    await withDaemon(async (daemon, ws) => {
      await writeFiles(ws, { "lib/in.ts": "export const x = 1;\n" });
      await symlink("/etc/hosts", ws.path("lib/out.ts")); // a link out of the workspace
      const auth = { authorization: `Bearer ${daemon.token}` };
      const get = (path: string, headers: Record<string, string> = auth) =>
        rawHttp(daemon.server.port, { path, headers });
      const missing = await get("/npm/left-pad");
      expect(missing.status).toBe(404);
      expect(bodyOf(missing)).toMatchObject({
        error: {
          message: expect.stringContaining("left-pad") as unknown,
          data: { name: "MissingPackage" },
        },
      });
      for (const path of [
        "/npm/.%2F..%2Fescape.ts",
        "/npm/.%2Flib%2Fout.ts",
        "/npm/.%2Flib%2Fnothing.ts",
        "/npm/%E0%A4",
        "/npm/Bad%20Name",
        "/npm/@demo",
      ]) {
        const answer = await get(path);
        expect([path, answer.status, answer.body]).toEqual([path, 404, ""]);
      }
      expect((await get("/npm/.%2Flib%2Fin.ts")).status).toBe(200);
      expect((await get("/npm/@demo/lib", {})).status).toBe(401);
    });
  });
});

describe("/npm/'s build failures", () => {
  it("are 500 with a JSON-RPC body naming the file or the package, and the next request tries again", async () => {
    await withDaemon(async (daemon, ws) => {
      await writeFiles(ws, {
        "lib/broken.ts": "export const x = ;\n",
        "node_modules/half-pkg/package.json":
          '{"name":"half-pkg","version":"1.0.0","type":"module","exports":"./index.js"}',
        "node_modules/half-pkg/index.js": 'export { gone } from "./gone.js";\n',
      });
      const get = (path: string) =>
        rawHttp(daemon.server.port, { path, headers: { authorization: `Bearer ${daemon.token}` } });
      for (const [path, named] of [
        ["/npm/.%2Flib%2Fbroken.ts", "./lib/broken.ts"],
        ["/npm/half-pkg", "half-pkg"],
      ] as const) {
        const answer = await get(path);
        expect([answer.status, bodyOf(answer)]).toMatchObject([
          500,
          { error: { data: { name: "NpmModuleFailed", data: { spec: named } } } },
        ]);
      }
      await writeFiles(ws, { "node_modules/half-pkg/gone.js": "export const gone = 1;\n" });
      expect((await get("/npm/half-pkg")).status).toBe(200);
    });
  });
});
