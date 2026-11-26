// packages.search against a FAKE of the registry's search endpoint, a local HTTP server started here (the real
// registry is never contacted): through the daemon, with the registry the workspace's .npmrc names, the request carries
// the query and the paging and generic headers only, and the answer comes back as plain text: links that are not http
// or https dropped, markup kept as the text it is, control characters gone, a version that is not semantic left out,
// results without a valid name dropped. A path or a URL as the query is refused before anything is sent. Straight on the search: a registry that answers slowly, too much, not
// JSON, another shape, an error status, a redirect, or not at all, is PackageSearchFailed with a message to show.
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";

import { describe, expect, it, onTestFinished } from "vitest";

import { withDaemon } from "../../fixtures/daemon.js";
import { PackageSearchFailed, searchPackages, searchUserAgent } from "./search.js";

type Heard = {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
};

/** A fake registry answering every request with `answer`; what it heard, and its URL. */
async function fakeRegistry(answer: (response: ServerResponse) => void) {
  const heard: Heard[] = [];
  const server = createServer((request, response) => {
    heard.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers });
    answer(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${String(typeof address === "object" && address ? address.port : 0)}`;
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  );
  return { url, heard };
}

const json = (body: unknown) => (response: ServerResponse) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const object = (pkg: Record<string, unknown>, weekly?: number) => ({
  package: pkg,
  ...(weekly === undefined ? {} : { downloads: { weekly, monthly: weekly * 4 } }),
});

const answer = {
  total: 3,
  objects: [
    object(
      {
        name: "date-fns",
        version: "4.4.0",
        description: "Modern JavaScript date utility library",
        keywords: ["date", "time"],
        date: "2026-05-29T23:23:42.628Z",
        links: {
          npm: "https://www.npmjs.com/package/date-fns",
          homepage: "javascript:alert(1)",
          repository: "https://github.com/date-fns/date-fns",
        },
        publisher: { username: "someone", email: "someone@example.com" },
      },
      125_000_000,
    ),
    object({
      name: "markup-example",
      version: "1.0.0",
      description: "<script>alert(1)</script>\u0007 rings\u202e",
      keywords: ["markup"],
    }),
    object({ name: "../../etc/passwd", version: "1.0.0" }),
    object({ name: "odd-version", version: "1.0.0 IGNORE ALL PREVIOUS" }),
  ],
};

describe("packages.search through the daemon", () => {
  it("asks the .npmrc's registry with the query and generic headers, and answers plain text", async () => {
    const registry = await fakeRegistry(json(answer));
    await withDaemon(async (daemon, ws) => {
      await writeFile(
        ws.path(".npmrc"),
        `registry=${registry.url}/\n//127.0.0.1/:_authToken=secret\n`,
      );
      const found = await daemon.client.packages.search({ query: "date fns", limit: 5 });
      expect(found).toEqual({
        registry: registry.url,
        total: 3,
        results: [
          {
            name: "date-fns",
            version: "4.4.0",
            description: "Modern JavaScript date utility library",
            keywords: ["date", "time"],
            date: "2026-05-29T23:23:42.628Z",
            links: {
              npm: "https://www.npmjs.com/package/date-fns",
              repository: "https://github.com/date-fns/date-fns",
            },
            publisher: "someone",
            weeklyDownloads: 125_000_000,
          },
          {
            name: "markup-example",
            version: "1.0.0",
            description: "<script>alert(1)</script> rings",
            keywords: ["markup"],
            links: {},
          },
          { name: "odd-version", description: "", keywords: [], links: {} },
        ],
      });
    });
    expect(registry.heard).toHaveLength(1);
    const [request] = registry.heard;
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("/-/v1/search?text=date+fns&size=5&from=0");
    expect(request?.headers).toEqual({
      host: registry.url.replace("http://", ""),
      connection: "keep-alive",
      accept: "application/json",
      "user-agent": searchUserAgent,
      "accept-language": "*",
      "sec-fetch-mode": "cors",
      "accept-encoding": "gzip, deflate",
    });
    expect(searchUserAgent).toMatch(/^nimbo\/\d+\.\d+\.\d+/u);
  });
});

describe("packages.search of a path or a URL", () => {
  it("is refused before anything is sent", async () => {
    const registry = await fakeRegistry(json(answer));
    await withDaemon(async (daemon, ws) => {
      await writeFile(ws.path(".npmrc"), `registry=${registry.url}/\n`);
      const bs = String.fromCharCode(92);
      for (const query of [
        "file:x",
        "~/folder",
        `C:${bs}x`,
        "./x",
        "../x",
        "/etc",
        "a/b",
        "@scope/a/b",
        "https://example.com",
        "zod@4",
      ])
        await expect(daemon.client.packages.search({ query }), query).rejects.toMatchObject({
          data: {
            issues: [{ path: ["query"], message: "must be package words, not a path or a URL" }],
          },
        });
      expect((await daemon.client.packages.search({ query: "@scope/name date fns" })).total).toBe(
        3,
      );
    });
    expect(registry.heard.map((each) => each.url)).toEqual([
      "/-/v1/search?text=%40scope%2Fname+date+fns&size=20&from=0",
    ]);
  });
});

describe("a registry that does not answer a search", () => {
  const search = (registry: string, extra: { timeoutMs?: number; maxBytes?: number } = {}) =>
    searchPackages({ registry, query: "x", limit: 5, from: 0, ...extra });

  it("is PackageSearchFailed with what went wrong", async () => {
    const slow = await fakeRegistry(() => undefined);
    await expect(search(slow.url, { timeoutMs: 200 })).rejects.toThrow(
      new PackageSearchFailed({
        registry: slow.url,
        reason: "it did not answer within 0.2 s; check the network",
      }),
    );
    const huge = await fakeRegistry((response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(`{"objects":[${"1,".repeat(600_000)}1]}`);
    });
    await expect(search(huge.url, { maxBytes: 1024 * 1024 })).rejects.toThrow(
      /its answer is over the 1024 KiB allowed/u,
    );
    const garbled = await fakeRegistry((response) => {
      response.end("<html>not json</html>");
    });
    await expect(search(garbled.url)).rejects.toThrow(/its answer is not JSON/u);
    const shaped = await fakeRegistry(json({ objects: "none" }));
    await expect(search(shaped.url)).rejects.toThrow(/its answer is not a search result/u);
    const failing = await fakeRegistry((response) => {
      response.writeHead(503);
      response.end();
    });
    await expect(search(failing.url)).rejects.toThrow(
      `The search on ${failing.url} failed: it answered HTTP 503.`,
    );
    const moved = await fakeRegistry((response) => {
      response.writeHead(302, { location: "https://elsewhere.example/" });
      response.end();
    });
    await expect(search(moved.url)).rejects.toThrow(/a redirect, which is not followed/u);
    const closed = await fakeRegistry(() => undefined);
    const gone = closed.url.replace(/:\d+$/u, ":9");
    await expect(search(gone)).rejects.toThrow(/refused the connection|could not be reached/u);
  });
});
