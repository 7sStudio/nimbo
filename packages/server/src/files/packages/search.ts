// packages.search: one GET of the registry's search endpoint (`/-/v1/search?text=&size=&from=`). Only the query and
// the paging go in the URL; the headers are Accept and a User-Agent naming nimbo and its version, no cookie, no token,
// nothing of the workspace. The answer is capped in time and in bytes, read as untrusted data: each result's texts cut
// to one line of capped length, its links kept only when they are http or https, a version that is not semantic left
// out, a result without a valid name dropped. A registry that cannot be reached, answers an error or something else
// than the search shape is PackageSearchFailed with a message the page shows as it is.
import { JsnbError } from "@jsnb/core";
import { z } from "zod";

import { serverVersion } from "../version.js";

type SearchResult = {
  readonly name: string;
  readonly version?: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly date?: string;
  readonly links: {
    readonly npm?: string;
    readonly homepage?: string;
    readonly repository?: string;
    readonly bugs?: string;
  };
  readonly publisher?: string;
  readonly weeklyDownloads?: number;
};

export type SearchAnswer = {
  readonly registry: string;
  readonly total: number;
  readonly results: readonly SearchResult[];
};

type Failure = { readonly registry: string; readonly reason: string };

/** The registry did not answer the search usefully. */
export class PackageSearchFailed extends JsnbError {
  declare readonly data: Failure;
  constructor(data: Failure, options: { readonly cause?: unknown } = {}) {
    super({
      name: "PackageSearchFailed",
      message: `The search on ${data.registry} failed: ${data.reason}.`,
      data,
      ...options,
    });
  }
}

export const searchUserAgent = `nimbo/${serverVersion}`;

/** The most a search may take, and the most bytes its answer may hold. */
const searchLimits = { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024 } as const;

const text = z
  .unknown()
  .optional()
  .transform((value) => (typeof value === "string" ? value : undefined));

const Answer = z.looseObject({
  total: z.number().optional(),
  objects: z.array(
    z.looseObject({
      package: z.looseObject({
        name: text,
        version: text,
        description: text,
        keywords: z.unknown().optional(),
        date: text,
        links: z.record(z.string(), z.unknown()).optional().catch(undefined),
        publisher: z.looseObject({ username: text }).optional().catch(undefined),
      }),
      downloads: z.looseObject({ weekly: z.number().optional() }).optional().catch(undefined),
    }),
  ),
});

/** A semantic version: three numbers, an optional pre-release and build, 64 characters at most. */
const semver = /^(?=.{5,64}$)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

const packageName = /^(?:@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/u;

/* eslint-disable no-control-regex -- the control characters are what this flattens */
const unsafe =
  /[\s\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]+/gu;
/* eslint-enable no-control-regex */

/** `value` as one line of at most `max` characters: control, zero-width and bidirectional characters and runs of white
 * space become one space, and a longer text is cut with an ellipsis. */
function line(value: string | undefined, max: number): string {
  const flat = (value ?? "").replace(unsafe, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A link of a result: http or https with no credentials, else none. */
const linkOf = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > 500 || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  const web = url.protocol === "https:" || url.protocol === "http:";
  return web && url.username === "" && url.password === "" ? value : undefined;
};

function resultOf(object: z.infer<typeof Answer>["objects"][number]): SearchResult | undefined {
  const pkg = object.package;
  const name = pkg.name ?? "";
  const version = semver.test(pkg.version ?? "") ? pkg.version : undefined;
  if (name.length > 214 || !packageName.test(name)) return undefined;
  const keywords = (Array.isArray(pkg.keywords) ? pkg.keywords : [])
    .filter((keyword): keyword is string => typeof keyword === "string")
    .map((keyword) => line(keyword, 50))
    .filter((keyword) => keyword !== "")
    .slice(0, 20);
  const links = Object.fromEntries(
    (["npm", "homepage", "repository", "bugs"] as const).flatMap((key) => {
      const url = linkOf(pkg.links?.[key]);
      return url === undefined ? [] : [[key, url]];
    }),
  );
  const date = line(pkg.date, 40);
  const publisher = line(pkg.publisher?.username, 100);
  const weekly = object.downloads?.weekly;
  return {
    name,
    ...(version === undefined ? {} : { version }),
    description: line(pkg.description, 300),
    keywords,
    ...(date === "" ? {} : { date }),
    links,
    ...(publisher === "" ? {} : { publisher }),
    ...(weekly !== undefined && Number.isSafeInteger(weekly) && weekly >= 0
      ? { weeklyDownloads: weekly }
      : {}),
  };
}

/** The body of `response`, refused once it is over `maxBytes`. */
async function cappedBody(response: Response, maxBytes: number): Promise<string | undefined> {
  if (response.body === null) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  // leaving the loop early cancels the stream: the rest of an answer too large is never read
  for await (const chunk of response.body) {
    const bytes: unknown = chunk;
    if (!(bytes instanceof Uint8Array)) return undefined;
    size += bytes.byteLength;
    if (size > maxBytes) return undefined;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const codeOf = (error: unknown): unknown => {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  return cause instanceof Error ? Reflect.get(cause, "code") : undefined;
};

/** Why fetch failed, in words a person can act on. */
function reasonOf(error: unknown, timedOut: number | undefined): string {
  if (timedOut !== undefined)
    return `it did not answer within ${String(timedOut / 1000)} s; check the network`;
  const code = codeOf(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return "its address could not be resolved; check the network";
  if (code === "ECONNREFUSED") return "it refused the connection";
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error && cause.message.includes("redirect"))
    return "it answered with a redirect, which is not followed";
  return "it could not be reached; check the network";
}

export type SearchQuery = {
  readonly registry: string;
  readonly query: string;
  readonly limit: number;
  readonly from: number;
  /** Aborts when the caller goes away. */
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
};

/** Searches `registry` for `query`. */
export async function searchPackages(search: SearchQuery): Promise<SearchAnswer> {
  const { registry } = search;
  const timeoutMs = search.timeoutMs ?? searchLimits.timeoutMs;
  const timeout = AbortSignal.timeout(timeoutMs);
  const url = new URL(`${registry}/-/v1/search`);
  url.searchParams.set("text", search.query);
  url.searchParams.set("size", String(search.limit));
  url.searchParams.set("from", String(search.from));
  const failed = (reason: string, cause?: unknown) =>
    new PackageSearchFailed({ registry, reason }, cause === undefined ? {} : { cause });
  let body: string | undefined;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": searchUserAgent },
      redirect: "error",
      credentials: "omit",
      signal: search.signal === undefined ? timeout : AbortSignal.any([timeout, search.signal]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw failed(`it answered HTTP ${String(response.status)}`);
    }
    body = await cappedBody(response, search.maxBytes ?? searchLimits.maxBytes);
  } catch (error) {
    if (error instanceof PackageSearchFailed) throw error;
    throw failed(reasonOf(error, timeout.aborted ? timeoutMs : undefined), error);
  }
  if (body === undefined)
    throw failed(
      `its answer is over the ${String((search.maxBytes ?? searchLimits.maxBytes) / 1024)} KiB allowed`,
    );
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (error) {
    throw failed("its answer is not JSON", error);
  }
  const answer = Answer.safeParse(json);
  if (!answer.success) throw failed("its answer is not a search result");
  const results = answer.data.objects
    .slice(0, search.limit)
    .flatMap((object) => resultOf(object) ?? []);
  const total = answer.data.total;
  return {
    registry: new URL(registry).origin,
    total:
      total !== undefined && Number.isSafeInteger(total) && total >= 0 ? total : results.length,
    results,
  };
}
