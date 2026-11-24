// The daemon's /feedback/ endpoint (server http/feedback.ts) from the page, with the page's token as the bearer header,
// as the full-value download sends it; and the shapes a feedback entry is made of.
import { pageAddress } from "./address.js";

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** What an entry records about the element it points at (feedback/locate.ts). */
export type Located = {
  readonly selector: string;
  readonly components: readonly string[];
  readonly element: {
    readonly tag: string;
    readonly text: string;
    readonly html: string;
    readonly rect: Rect;
    readonly styles: Readonly<Record<string, string>>;
  };
  readonly cell?: { readonly id: string; readonly index: number; readonly type: string };
};

/** The two screenshots as base64 PNG (feedback/capture.ts); either is missing when the capture failed. */
export type Shots = { readonly element?: string; readonly viewport?: string };

export type FeedbackStatus = "open" | "done";

/** What the page sends for one entry; the daemon adds the id, the time, the status and its own version. */
export type FeedbackDraft = Omit<Located, "cell"> & {
  readonly text: string;
  readonly area?: Rect;
  readonly page: {
    readonly kind: "home" | "notebook" | "output";
    readonly path: string;
    readonly notebook: string;
    readonly cell?: Located["cell"];
    readonly title: string;
    readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number };
    readonly theme: string;
  };
  readonly app: { readonly version: string; readonly commit: string };
  readonly shots: Shots;
};

export type FeedbackEntry = Omit<FeedbackDraft, "shots"> & {
  readonly id: string;
  readonly at: string;
  readonly status: FeedbackStatus;
  /** The screenshots' file names in the feedback folder. */
  readonly shots: Shots;
};

export type FeedbackList = { readonly dir: string; readonly entries: readonly FeedbackEntry[] };

/** A refusal or failure of the endpoint, or an answer that is not what it should be. */
class FeedbackFailed extends Error {
  constructor(what: string) {
    super(what);
    this.name = "FeedbackFailed";
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The daemon's entry: its shape is the server's (files/feedback/feedbackStore.ts), checked where it matters here. */
function isEntry(value: unknown): value is FeedbackEntry {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    (value.status === "open" || value.status === "done") &&
    isObject(value.page) &&
    isObject(value.element) &&
    isObject(value.shots) &&
    Array.isArray(value.components)
  );
}

function entryOf(value: unknown): FeedbackEntry {
  if (!isEntry(value)) throw new FeedbackFailed("The daemon answered no feedback entry.");
  return value;
}

function listOf(value: unknown): FeedbackList {
  if (!isObject(value) || typeof value.dir !== "string" || !Array.isArray(value.entries))
    throw new FeedbackFailed("The daemon answered no feedback list.");
  return { dir: value.dir, entries: value.entries.filter(isEntry) };
}

/** Below the browsers' 64 KiB budget for the bodies of keepalive requests still in flight. */
const keepaliveBytes = 60_000;

const call = async (method: string, path: string, body?: unknown): Promise<Response> => {
  const address = pageAddress(location);
  const text = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(new URL(`/feedback/${path}`, location.origin), {
    method,
    headers: {
      authorization: `Bearer ${address?.token ?? ""}`,
      ...(text === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(text === undefined ? {} : { body: text }),
    // a request that outlives the page, so that a note saved just before a reload or a close is still stored
    keepalive: text !== undefined && new TextEncoder().encode(text).length < keepaliveBytes,
  });
  if (!response.ok)
    throw new FeedbackFailed(
      `${method} /feedback/${path} failed (HTTP ${String(response.status)})`,
    );
  return response;
};

const json = async (response: Promise<Response>): Promise<unknown> => (await response).json();

export const feedbackApi = {
  list: async (): Promise<FeedbackList> => listOf(await json(call("GET", ""))),
  add: async (draft: FeedbackDraft): Promise<FeedbackEntry> =>
    entryOf(await json(call("POST", "", draft))),
  /** Adds the screenshots to the stored entry `id`. */
  attach: async (id: string, shots: Shots): Promise<FeedbackEntry> =>
    entryOf(await json(call("PUT", `${encodeURIComponent(id)}/shots`, shots))),
  change: async (
    id: string,
    change: { readonly status?: FeedbackStatus; readonly text?: string },
  ): Promise<FeedbackEntry> => entryOf(await json(call("PATCH", encodeURIComponent(id), change))),
  remove: async (id: string): Promise<void> => {
    await call("DELETE", encodeURIComponent(id));
  },
  /** A screenshot as an object URL the caller revokes. */
  shot: async (name: string): Promise<string> =>
    URL.createObjectURL(await (await call("GET", `shots/${encodeURIComponent(name)}`)).blob()),
};
