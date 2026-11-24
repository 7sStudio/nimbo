// The realm's call failures of 03-api §7.4: a client cell run with no page (1004) and a second page that tries to
// attach while another runs the client cells (1011); each is an ApiError of the catalogue in api.ts.
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
