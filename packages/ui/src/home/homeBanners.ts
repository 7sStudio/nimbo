// The Home page's banners: the connection's only, as the notebook page words them but naming the
// Home page: a start that stopped (a stale token: "Not authorized") or a socket closed for good, then a reconnect
// that is taking long. Home has no kernel, save, page or install of its own to speak of.
import type { BannerModel } from "../app/models.js";
import type { BannerFacts } from "../app/bannerList.js";

export type HomeBannerFacts = Pick<
  BannerFacts,
  "failure" | "stopped" | "connection" | "reconnectingLong"
>;

const again = "Open the Home page again with nimbo open.";

function notConnected(failure: string | null): BannerModel {
  const words =
    failure === "Unauthorized"
      ? {
          title: "Not authorized",
          text: `This page's token is no longer valid, for example after the daemon restarted. ${again}`,
        }
      : failure === null
        ? { title: "Disconnected", text: `The connection to the daemon is closed. ${again}` }
        : {
            title: "Could not load the notebooks",
            text: `The daemon refused it (${failure}). ${again}`,
          };
  return { id: "notConnected", tone: "error", ...words, actions: [] };
}

const reconnecting: BannerModel = {
  id: "reconnecting",
  tone: "warn",
  title: "Still reconnecting",
  text: `The daemon has not answered for a while. If it stopped or restarted, ${again.charAt(0).toLowerCase()}${again.slice(1)}`,
  actions: [],
};

export function homeBanners(facts: HomeBannerFacts): readonly BannerModel[] {
  if (facts.stopped || facts.connection === "closed") return [notConnected(facts.failure)];
  return facts.reconnectingLong && facts.connection === "reconnecting" ? [reconnecting] : [];
}
