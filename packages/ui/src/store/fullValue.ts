// The full value of a retained output for the output viewer's "load the whole value": the download goes
// through the client with the page's token as the bearer header, the one way /outputs/ accepts.
import { downloadValue } from "@jsnb/client";
import { JsnbError } from "@jsnb/core";

import type { PageAddress } from "./address.js";

/** The `/outputs/<execution>/<index>.json` path of a value output, what the viewer is given as its full-value URL. */
export const fullValuePath = (execution: string, index: number): string =>
  `/outputs/${encodeURIComponent(execution)}/${String(index)}.json`;

/** The viewer asked for a URL that is not one fullValuePath made: an output-view bug, never a user's error. */
class NotAFullValueUrl extends JsnbError {
  constructor(url: string) {
    super({ name: "NotAFullValueUrl", message: `${url} is not a full-value URL` });
  }
}

/** The viewer's onFetchFullValue for the daemon at `address`: the path read back into its ref, then downloaded. */
export function fullValueFetcher(address: Pick<PageAddress, "url" | "token">) {
  return async (url: string, signal: AbortSignal): Promise<Blob> => {
    const match = /^\/outputs\/([^/]+)\/(\d+)\.json$/u.exec(new URL(url, address.url).pathname);
    if (match === null) throw new NotAFullValueUrl(url);
    const ref = { execution: decodeURIComponent(match[1] ?? ""), index: Number(match[2]) };
    const options = { url: address.url, token: address.token, client: "ui" as const };
    const response = await downloadValue(options, ref, { signal });
    return response.blob();
  };
}
