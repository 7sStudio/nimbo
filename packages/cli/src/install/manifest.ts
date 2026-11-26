// A release's manifest.json and the artefacts it names: fetched from the releases base (an
// http(s) URL, a file:// URL or an absolute folder, so a release can be tried from disk), each tarball checked against
// the manifest's size and SHA-256 before anything is unpacked.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { JsnbError } from "@jsnb/core";
import { z } from "zod";

import { InstallFailed } from "./errors.js";
import { isReleaseVersion } from "./versions.js";

const Artefact = z.object({
  file: z
    .string()
    .regex(/^[A-Za-z0-9]+-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-[a-z]+-[a-z0-9]+\.tar\.gz$/u),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});
export type Artefact = z.infer<typeof Artefact>;

export const Manifest = z.object({
  name: z.string(),
  version: z.string().refine(isReleaseVersion, "not a release version such as 0.2.0"),
  commit: z.string().max(64),
  targets: z.record(z.string(), Artefact),
});
export type Manifest = z.infer<typeof Manifest>;

/** A release could not be fetched, read or trusted. */
class ReleaseUnavailable extends JsnbError {
  declare readonly data: { readonly url: string; readonly reason: string };
  constructor(
    data: { readonly url: string; readonly reason: string },
    options: { cause?: unknown } = {},
  ) {
    super({
      name: "ReleaseUnavailable",
      message: `${data.reason} (${data.url}).`,
      data,
      ...options,
    });
  }
}

/** The folder a release's files are in: the latest release's, or version `version`'s (GitHub's layout). */
export function releaseFolder(base: string, version: string | undefined): string {
  const root = base.replace(/\/+$/u, "");
  return version === undefined ? `${root}/latest/download` : `${root}/download/v${version}`;
}

/** Nothing at `url`: the server answered 404, or the file is not there. */
export class ReleaseMissing extends JsnbError {
  declare readonly data: { readonly url: string };
  constructor(data: { readonly url: string }) {
    super({ name: "ReleaseMissing", message: `Nothing at ${data.url}.`, data });
  }
}

export type FetchOptions = {
  /** Bytes received so far, and the total when the server says it. */
  readonly onProgress?: (received: number, total: number | undefined) => void;
  readonly signal?: AbortSignal;
  /** How long the server may stay silent, 30 s by default. */
  readonly idleMs?: number;
};

/** The next chunk of `reader`, or undefined at the end; the server may stay silent `idleMs` at most. */
async function nextChunk(
  reader: ReadableStreamDefaultReader,
  url: string,
  idleMs: number,
): Promise<Uint8Array | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ReleaseUnavailable({ url, reason: "The release server stopped sending" }));
    }, idleMs);
  });
  try {
    const next: unknown = await Promise.race([reader.read(), idle]);
    const value: unknown = Reflect.get(Object(next), "value");
    if (Reflect.get(Object(next), "done") === true) return undefined;
    return value instanceof Uint8Array ? value : new Uint8Array();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** The body of `response`, read chunk by chunk. */
async function readBody(
  response: Response,
  url: string,
  options: FetchOptions,
): Promise<Uint8Array> {
  const header = Number(response.headers.get("content-length") ?? "");
  const total = Number.isFinite(header) && header > 0 ? header : undefined;
  const body = response.body;
  if (body === null) return new Uint8Array(await response.arrayBuffer());
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const chunk = await nextChunk(reader, url, options.idleMs ?? 30_000);
    if (chunk === undefined) break;
    chunks.push(chunk);
    received += chunk.byteLength;
    options.onProgress?.(received, total);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** The server's answer to `url`, which must start within `idleMs`; the body is read (and timed) apart. */
async function answer(url: string, options: FetchOptions): Promise<Response> {
  const waiting = new AbortController();
  const timer = setTimeout(() => {
    waiting.abort(new DOMException("The release server did not answer", "TimeoutError"));
  }, options.idleMs ?? 30_000);
  const signal =
    options.signal === undefined
      ? waiting.signal
      : AbortSignal.any([waiting.signal, options.signal]);
  try {
    return await fetch(url, { redirect: "follow", signal });
  } finally {
    clearTimeout(timer);
  }
}

async function download(url: string, options: FetchOptions): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await answer(url, options);
  } catch (error) {
    if (options.signal?.aborted === true) throw error;
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new ReleaseUnavailable(
      {
        url,
        reason: timedOut
          ? "The release server did not answer in time"
          : "The release server could not be reached",
      },
      { cause: error },
    );
  }
  if (response.status === 404) throw new ReleaseMissing({ url });
  if (!response.ok) {
    throw new ReleaseUnavailable({
      url,
      reason: `The release server answered ${String(response.status)}`,
    });
  }
  return readBody(response, url, options);
}

/** The bytes at `url`: an http(s) download, a file:// URL or an absolute path. */
export async function fetchBytes(url: string, options: FetchOptions = {}): Promise<Uint8Array> {
  if (/^https?:\/\//u.test(url)) return download(url, options);
  const path = url.startsWith("file://") ? fileURLToPath(url) : url;
  if (!isAbsolute(path)) {
    throw new ReleaseUnavailable({
      url,
      reason: "The releases base is not an http(s) URL, a file:// URL or an absolute folder",
    });
  }
  try {
    const bytes = new Uint8Array(await readFile(path));
    options.onProgress?.(bytes.byteLength, bytes.byteLength);
    return bytes;
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT")
      throw new ReleaseMissing({ url });
    throw new ReleaseUnavailable(
      { url, reason: "The release file could not be read" },
      { cause: error },
    );
  }
}

/** The manifest in `bytes`, or ReleaseUnavailable naming `url`. */
export function parseManifest(bytes: Uint8Array, url: string): Manifest {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new InstallFailed(
      {
        what: `The release's manifest is not JSON (${url}).`,
        todo: "The release looks wrong; report it.",
      },
      { cause: error },
    );
  }
  const parsed = Manifest.safeParse(json);
  if (!parsed.success) {
    throw new InstallFailed({
      what: `The release's manifest does not have the expected shape (${url}).`,
      todo: "The release looks wrong; report it.",
    });
  }
  return parsed.data;
}

export const sha256Of = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Throws InstallFailed unless `bytes` are exactly the artefact the manifest describes. */
export function verifyArtefact(bytes: Uint8Array, artefact: Artefact, url: string): void {
  const todo =
    "Nothing was installed. Try again; if it fails again, the release is damaged: report it.";
  if (bytes.byteLength !== artefact.size) {
    throw new InstallFailed({
      what:
        bytes.byteLength < artefact.size
          ? `The download of ${artefact.file} is incomplete.`
          : `The download of ${artefact.file} is larger than the release says.`,
      todo,
      details: [
        `expected  ${String(artefact.size)} bytes`,
        `received  ${String(bytes.byteLength)} bytes`,
        `from      ${url}`,
      ],
    });
  }
  const found = sha256Of(bytes);
  if (found !== artefact.sha256) {
    throw new InstallFailed({
      what: `The download of ${artefact.file} does not match its checksum.`,
      todo,
      details: [`expected  ${artefact.sha256}`, `received  ${found}`, `from      ${url}`],
    });
  }
}
