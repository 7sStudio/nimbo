// The banner stack, in its fixed order: kernel exited, could not save, changed on disk, no page
// attached, view only, installing; above them all, a page whose start stopped or whose connection is closed for good (a
// stale token, a notebook that is not open, a daemon gone), then a reconnect that is taking long, then a notebook
// another client closed. Each is a condition of the stores; its buttons are command ids.
import type { BannerModel } from "./models.js";
import { failureWords } from "./startFailure.js";

export type BannerFacts = {
  /** The kernel died on its own: its exit code or signal, or "" when neither is known. */
  readonly kernelExit: string | null;
  readonly save: "saved" | "writing" | "failed" | "conflict";
  readonly saveError: string | null;
  readonly connection: "connecting" | "live" | "reconnecting" | "closed" | "viewOnly";
  /** Some tab holds the notebook's page (the mirror's realm.attached). */
  readonly pageAttached: boolean;
  /** This tab's own attach: a banner about the page waits until it settled, so the holding tab never flashes it. */
  readonly ownAttach: "pending" | "attached" | "viewOnly" | "failed";
  /** Why this tab's attach failed, when it did for another reason than a second tab. */
  readonly attachError: string | null;
  /** This tab held the page until another tab took it over. */
  readonly takenOver?: boolean;
  /** The name of the error that stopped the page's start (Unauthorized for a stale token), or null. */
  readonly failure: string | null;
  /** The page's start stopped (a stale token, a notebook that is gone): the failure banner shows whatever the socket. */
  readonly stopped: boolean;
  /** The notebook the page asked for, named by the failure banners. */
  readonly notebook: string;
  /** The socket has been reconnecting for longer than a daemon restart takes (app/useLongReconnect.ts). */
  readonly reconnectingLong: boolean;
  /** Another client closed the notebook (notebook.closed): its own banner, and none about the page or the kernel. */
  readonly closed: boolean;
  readonly installing: {
    readonly names: readonly string[];
    readonly line: string | null;
    readonly action: "add" | "remove";
  } | null;
};

function kernelExited(exit: string): BannerModel {
  return {
    id: "kernelExited",
    tone: "error",
    title: "Kernel exited",
    text: exit === "" ? "The server realm stopped." : `The server realm stopped with ${exit}.`,
    actions: [
      { label: "Restart now", command: "kernel.restart", primary: true },
      { label: "Kernel log", command: "ui.kernelLog.open" },
    ],
  };
}

const saveFailed = (error: string | null): BannerModel => ({
  id: "saveFailed",
  tone: "error",
  title: "Could not save",
  text: error ?? "The notebook could not be written to disk.",
  actions: [{ label: "Retry", command: "notebook.save" }],
});

const conflict: BannerModel = {
  id: "conflict",
  tone: "warn",
  title: "Changed on disk",
  text: "The file changed outside nimbo since it was last saved.",
  actions: [
    { label: "Reload from disk", command: "notebook.reload", primary: true },
    { label: "Overwrite with mine", command: "notebook.save", args: { force: true } },
  ],
};

const noPage = (error: string | null): BannerModel => ({
  id: "noPage",
  tone: "neutral",
  title: "No page attached",
  text: "Client cells cannot run until this notebook is open in a browser tab.",
  ...(error === null ? {} : { detail: `This tab could not attach: ${error}` }),
  actions: [],
});

const notConnected = (failure: string | null, notebook: string): BannerModel => ({
  id: "notConnected",
  tone: "error",
  ...failureWords(failure, notebook),
  // Home helps when this notebook is gone or refused; a stale token or a gone daemon would fail there the same way
  actions:
    failure === "Unauthorized" || failure === null
      ? []
      : [{ label: "Home", command: "ui.home.open", primary: true }],
});

const reconnectingLong = (notebook: string): BannerModel => ({
  id: "reconnecting",
  tone: "warn",
  title: "Still reconnecting",
  text: `No answer from the daemon. If it stopped, reopen with nimbo open ${notebook}.`,
  actions: [],
});

/** A notebook closed while the socket is live follows its reopen; closed and then the socket lost (`nimbo stop` closes
 * every notebook before the daemon goes), the daemon may be gone, and `nimbo open` would start a new one on a new port
 * this tab cannot follow, so the banner promises nothing. */
const notebookClosed = (notebook: string, live: boolean): BannerModel => ({
  id: "notebookClosed",
  tone: "warn",
  title: "Notebook closed",
  text: live
    ? `Another client closed ${notebook}; its kernel stopped. This tab follows it when it reopens.`
    : `${notebook} was closed and the daemon no longer answers. Reopen with nimbo open ${notebook}.`,
  actions: live ? [{ label: "Home", command: "ui.home.open" }] : [],
});

/** A second tab, or the tab another one took the page from: Take Over moves the live page here. */
const viewOnly = (takenOver: boolean): BannerModel => ({
  id: "viewOnly",
  tone: "warn",
  title: "View only",
  text: takenOver
    ? "Another tab took over the live page. Client outputs here are snapshots."
    : "Another tab owns the live page for this notebook. Client outputs here are snapshots.",
  actions: [{ label: "Take Over", command: "ui.realm.takeOver" }],
});

/** An add or a remove under way, its last progress line beneath, Cancel stopping it. */
const installing = (run: NonNullable<BannerFacts["installing"]>): BannerModel => ({
  id: "installing",
  tone: "accent",
  title: run.action === "add" ? "Installing" : "Removing",
  text: run.names.join(" "),
  ...(run.line === null ? {} : { detail: run.line }),
  actions: [{ label: "Cancel", command: "ui.packages.cancel" }],
});

/** The banners about the connection itself, first in the stack: a start that stopped or a socket closed for good,
 * then a reconnect that is taking long. */
function connectionBanners(facts: BannerFacts): readonly (BannerModel | null)[] {
  return [
    facts.stopped || facts.connection === "closed"
      ? notConnected(facts.failure, facts.notebook)
      : null,
    facts.reconnectingLong && facts.connection === "reconnecting"
      ? reconnectingLong(facts.notebook)
      : null,
    facts.closed && !facts.stopped
      ? notebookClosed(facts.notebook, facts.connection === "live")
      : null,
  ];
}

/** Whether the "no page attached" banner applies: a live socket, this tab's attach settled, an open notebook nobody
 * holds the page of. */
const pageMissing = (facts: BannerFacts): boolean =>
  facts.connection === "live" &&
  facts.ownAttach !== "pending" &&
  !facts.closed &&
  !facts.pageAttached;

/** The banners `facts` call for, order. */
export function bannersOf(facts: BannerFacts): readonly BannerModel[] {
  return [
    ...connectionBanners(facts),
    facts.kernelExit === null || facts.closed ? null : kernelExited(facts.kernelExit),
    facts.save === "failed" ? saveFailed(facts.saveError) : null,
    facts.save === "conflict" ? conflict : null,
    pageMissing(facts) ? noPage(facts.attachError) : null,
    facts.connection === "viewOnly" ? viewOnly(facts.takenOver === true) : null,
    facts.installing === null ? null : installing(facts.installing),
  ].filter((banner) => banner !== null);
}
