// The headless page's side of the debugger's CDP relay (../debug/relay.ts): one new CDP session on the one page, never
// the browser's, carrying only what a debugger needs of a page: the Runtime, Debugger and Profiler domains and
// DOM.describeNode for element previews; any other method is refused. The relay's folder goes under `.jsnb/headless/`.
import type { CDPSession, Page } from "puppeteer-core";

import type { Log } from "../../events/log.js";
import type { CdpRelay } from "../debug/relay.js";
import { openCdpRelay } from "../debug/relay.js";

const relayed = /^(?:Runtime|Debugger|Profiler)\.[A-Za-z]+$/u;

/** A CDP method's name, as the session takes it. */
type Method = Extract<Parameters<CDPSession["send"]>[0], string>;

/** Whether js-debug may call `method` on the page. */
const allowedMethod = (method: string): method is Method =>
  relayed.test(method) || method === "DOM.describeNode";

const failure = (error: unknown): { readonly code: number; readonly message: string } => {
  const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined;
  const original: unknown =
    error instanceof Error ? Reflect.get(error, "originalMessage") : undefined;
  return {
    code: typeof code === "number" ? code : -32000,
    message:
      typeof original === "string" && original !== ""
        ? original
        : error instanceof Error
          ? error.message
          : String(error),
  };
};

/** Opens the relay to `page` in a new folder under `dir`; the first connection to its address is js-debug's. */
export async function openPageRelay(
  page: Page,
  options: { readonly dir: string; readonly log: Log },
): Promise<CdpRelay> {
  const relay = await openCdpRelay({
    dir: options.dir,
    log: options.log,
    allow: allowedMethod,
    connect: async (deliver, lost) => {
      const session = await page.createCDPSession();
      session.on("*", (type: unknown, event: unknown) => {
        if (typeof type === "string") deliver({ method: type, params: event });
      });
      page.once("close", lost);
      return {
        request: (id, method, params) => {
          // allowedMethod passed it; the request goes to this session only
          if (!allowedMethod(method)) return;
          session.send(method, params).then(
            (result) => {
              deliver({ id, result });
            },
            (error: unknown) => {
              deliver({ id, error: failure(error) });
            },
          );
        },
        close: () => {
          void session.detach().catch(() => undefined);
        },
      };
    },
  });
  page.once("close", relay.close);
  return relay;
}
