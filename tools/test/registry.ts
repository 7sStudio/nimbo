// A STUB of the npm registry, named as one (09-testing §1.3, §8): the real registry is an external service no
// test can produce on demand, so a local HTTP server answers what an install asks for (a packument per package and its
// tarball), and the real package manager runs against it through the workspace's .npmrc (registry, its own cache, no
// audit, no fund, no update check), so nothing is fetched from the network or written to the user's home. It can hold
// a package's requests unanswered, as a registry that hangs does.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";

import type { Workspace } from "./workspace.js";

export type StubPackage = {
  readonly name: string;
  readonly version: string;
  /** Files below the package's folder, package.json included. */
  readonly files: Readonly<Record<string, string>>;
};

/** One 512-byte ustar header for a regular file `name` of `size` bytes. */
function header(name: string, size: number): Buffer {
  const block = Buffer.alloc(512);
  const put = (text: string, at: number, length: number): void => {
    block.write(text.slice(0, length), at, "ascii");
  };
  const octal = (value: number, length: number): string =>
    `${value.toString(8).padStart(length - 1, "0")}\0`;
  put(name, 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(0, 12), 136, 12);
  put("        ", 148, 8);
  put("0", 156, 1);
  put("ustar\u000000", 257, 8);
  const sum = block.reduce((total, byte) => total + byte, 0);
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return block;
}

/** The gzipped ustar archive of `files` under `package/`, as npm packs one. */
function tarballOf(files: Readonly<Record<string, string>>): Buffer {
  const parts = Object.entries(files).flatMap(([path, text]) => {
    const body = Buffer.from(text);
    const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
    return [header(`package/${path}`, body.length), body, padding];
  });
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}

/** The version manifest of `pkg` with its tarball at `url`. */
function manifestOf(pkg: StubPackage, tarball: Buffer, url: string): object {
  const dist = {
    tarball: url,
    shasum: createHash("sha1").update(tarball).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
  };
  // A registry's version manifest carries the package.json's fields (its dependencies among them), as npm's does.
  const declared: unknown = JSON.parse(pkg.files["package.json"] ?? "{}");
  const fields = typeof declared === "object" && declared !== null ? declared : {};
  return { ...fields, name: pkg.name, version: pkg.version, dist };
}

export type StubRegistry = {
  readonly url: string;
  /** Settles once a request for a held package arrived (the manager is past its start, waiting on the registry). */
  readonly held: Promise<void>;
  /** Stops holding: the requests held so far are answered now, and later ones at once (a slow registry that ends). */
  readonly release: () => void;
  readonly close: () => Promise<void>;
};

/**
 * Takes the npm_config_* variables out of this test process's environment, which the daemon passes to the package
 * manager, so a registry set by whatever started the tests (npx sets some) cannot win over the workspace's .npmrc;
 * the returned function puts them back.
 */
function isolateNpmConfig(): () => void {
  const saved = Object.entries(process.env).filter(([name]) =>
    name.toLowerCase().startsWith("npm_config_"),
  );
  for (const [name] of saved) Reflect.deleteProperty(process.env, name);
  return () => {
    for (const [name, value] of saved) process.env[name] = value;
  };
}

type Route = { readonly type: string; readonly body: Buffer | string };

/**
 * The packument and tarball routes of `packages`, served from `url`: one packument per name with every version given,
 * the last one given its `latest`.
 */
function routesOf(packages: readonly StubPackage[], url: string): Map<string, Route> {
  const routes = new Map<string, Route>();
  const versions = new Map<string, Record<string, object>>();
  for (const pkg of packages) {
    const tarball = tarballOf(pkg.files);
    const path = `/${pkg.name}/-/${pkg.name.split("/").pop() ?? pkg.name}-${pkg.version}.tgz`;
    routes.set(path, { type: "application/octet-stream", body: tarball });
    const all = {
      ...versions.get(pkg.name),
      [pkg.version]: manifestOf(pkg, tarball, `${url}${path}`),
    };
    versions.set(pkg.name, all);
    const packument = { name: pkg.name, "dist-tags": { latest: pkg.version }, versions: all };
    routes.set(`/${pkg.name}`, { type: "application/json", body: JSON.stringify(packument) });
  }
  return routes;
}

/**
 * The workspace's .npmrc: the stub as the registry, its own caches (npm's, and pnpm's store, cache and state), no
 * audit, no fund, no update check; nothing reaches the network or the user's home.
 */
async function writeNpmrc(ws: Workspace, url: string): Promise<void> {
  const npmrc = [
    `registry=${url}/`,
    `cache=${ws.path(".npm-cache")}`,
    `store-dir=${ws.path(".pnpm-store")}`,
    `cache-dir=${ws.path(".pnpm-cache")}`,
    `state-dir=${ws.path(".pnpm-state")}`,
    "audit=false",
    "fund=false",
    "update-notifier=false",
  ];
  await writeFile(ws.path(".npmrc"), `${npmrc.join("\n")}\n`);
}

/** The held paths: a request for one waits (`ask`) until `release` answers it with `answer`, and later ones at once. */
function holder(hold: readonly string[], answer: (path: string, response: ServerResponse) => void) {
  const held = new Set(hold.map((name) => `/${name}`));
  const waiting: (() => void)[] = [];
  let heard = (): void => undefined;
  const asked = new Promise<void>((resolve) => (heard = resolve));
  return {
    asked,
    /** True when `path` is held: the response waits for release (or closeAllConnections ends it). */
    holds: (path: string, response: ServerResponse): boolean => {
      if (!held.has(path)) return false;
      heard();
      waiting.push(() => {
        answer(path, response);
      });
      return true;
    },
    release: () => {
      held.clear();
      for (const respond of waiting.splice(0)) respond();
    },
  };
}

/**
 * Serves `packages` on 127.0.0.1 and writes the workspace's .npmrc to use it; a request for a package named in `hold`
 * is not answered (a registry that hangs) until `release` or the stub closes.
 */
export async function startRegistry(
  ws: Workspace,
  packages: readonly StubPackage[],
  options: { readonly hold?: readonly string[] } = {},
): Promise<StubRegistry> {
  let routes = new Map<string, Route>();
  const answer = (path: string, response: ServerResponse) => {
    const found = routes.get(path);
    response.writeHead(found ? 200 : 404, { "content-type": found?.type ?? "application/json" });
    response.end(found?.body ?? "{}");
  };
  const hold = holder(options.hold ?? [], answer);
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent(request.url ?? "");
    if (!hold.holds(path, response)) answer(path, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${String(typeof address === "object" && address ? address.port : 0)}`;
  routes = routesOf(packages, url);
  await writeNpmrc(ws, url);
  const restore = isolateNpmConfig();
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      restore();
      server.close(() => {
        resolve();
      });
      server.closeAllConnections();
    });
  return { url, held: hold.asked, release: hold.release, close };
}
