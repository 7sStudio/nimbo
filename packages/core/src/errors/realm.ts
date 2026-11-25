// The realm's call failures of 03-api §7.4: a client cell run with no page (1004), a second page that tries to attach
// while another runs the client cells (1011), and a page that does not answer the daemon's request in time (1015);
// each is an ApiError of the catalogue in api.ts.
import { ApiError } from "./api.js";

type Cause = { readonly cause?: unknown };

const realmNotAttachedMessage = (notebook: string): string =>
  `No notebook page is open for ${notebook}; open it in the browser to run client cells.`;

export class RealmNotAttached extends ApiError {
  declare readonly data: { readonly notebook: string };
  constructor(data: { readonly notebook: string }, options: Cause = {}) {
    super(1004, {
      name: "RealmNotAttached",
      message: realmNotAttachedMessage(data.notebook),
      data,
      ...options,
    });
  }
}

const realmAttachedMessage = (notebook: string): string =>
  `Another page already runs the client cells of ${notebook}, so this one is view-only. Close that page and reload this one to run client cells here.`;

/** `realm.attach` of a second page: the first attach wins and later pages are view-only (03-api §4.5). */
export class RealmAttached extends ApiError {
  declare readonly data: { readonly notebook: string };
  constructor(data: { readonly notebook: string }, options: Cause = {}) {
    super(1011, {
      name: "RealmAttached",
      message: realmAttachedMessage(data.notebook),
      data,
      ...options,
    });
  }
}

type PageTimeoutData = {
  readonly notebook: string;
  readonly request: string;
  readonly timeoutMs: number;
};

const pageTimeoutMessage = ({ notebook, request, timeoutMs }: PageTimeoutData): string =>
  `The page holding ${notebook} did not answer ${request} within ${String(timeoutMs / 1000)}s: a client cell may keep it busy. Try again, or reload the page.`;

/** The attached page did not answer one of the daemon's requests (`realm.snapshot`) in time. */
export class PageTimeout extends ApiError {
  declare readonly data: PageTimeoutData;
  constructor(data: PageTimeoutData, options: Cause = {}) {
    super(1015, { name: "PageTimeout", message: pageTimeoutMessage(data), data, ...options });
  }
}
