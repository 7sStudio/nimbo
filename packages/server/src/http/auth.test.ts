// The credentials of 03-api §7.1 and the page cookie: constant-time checks, the bearer header, the page
// cookie named after the daemon's port and set for /ui/ and /npm/ only, another port's cookie ignored.
import type { IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import {
  bearerOf,
  cookieOf,
  hasBearer,
  hasPageCredentials,
  isPageCookieName,
  isToken,
  pageCookieName,
  pageCookies,
} from "./auth.js";

const request = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
const cookie = { name: () => pageCookieName(4100), key: "k3y" };

describe("isToken", () => {
  it("is true for the token only", () => {
    expect(isToken("abc", "abc")).toBe(true);
    expect(isToken("abd", "abc")).toBe(false);
    expect(isToken("ab", "abc")).toBe(false);
    expect(isToken(undefined, "abc")).toBe(false);
  });
});

describe("bearerOf and cookieOf", () => {
  it("read the bearer header and a cookie by its name", () => {
    expect(bearerOf(request({ authorization: "Bearer t0k" }))).toBe("t0k");
    expect(bearerOf(request({ authorization: "Basic t0k" }))).toBeUndefined();
    expect(cookieOf(request({ cookie: "a=1; nimbo-4100=k3y; b=2" }), "nimbo-4100")).toBe("k3y");
    expect(cookieOf(request({ cookie: "a=1" }), "nimbo-4100")).toBeUndefined();
    expect(cookieOf(request({}), "nimbo-4100")).toBeUndefined();
  });
});

describe("the page cookie", () => {
  it("is named after the port, holds the page key, and is set for /ui/ and /npm/ only", () => {
    expect(pageCookies(cookie)).toEqual([
      "nimbo-4100=k3y; HttpOnly; SameSite=Strict; Path=/ui/",
      "nimbo-4100=k3y; HttpOnly; SameSite=Strict; Path=/npm/",
    ]);
    expect([isPageCookieName("nimbo-4100"), isPageCookieName("jsnb_token")]).toEqual([true, false]);
  });

  it("lets a page GET in with the bearer header or this daemon's key, never another port's", () => {
    const own = { "sec-fetch-site": "same-origin" };
    expect(hasPageCredentials(request({ cookie: "nimbo-4100=k3y", ...own }), "t", cookie)).toBe(
      true,
    );
    expect(hasPageCredentials(request({ authorization: "Bearer t" }), "t", cookie)).toBe(true);
    expect(hasPageCredentials(request({ cookie: "nimbo-4100=t", ...own }), "t", cookie)).toBe(
      false,
    );
    expect(hasPageCredentials(request({ cookie: "nimbo-4100=k3y" }), "t", cookie)).toBe(false);
    expect(hasPageCredentials(request({ cookie: "nimbo-4200=k3y", ...own }), "t", cookie)).toBe(
      false,
    );
  });

  it("takes the cookie from a browser on the daemon's own page only (Sec-Fetch-Site)", () => {
    const sent = (site: string) => request({ cookie: "nimbo-4100=k3y", "sec-fetch-site": site });
    expect(
      ["same-origin", "none", "same-site", "cross-site"].map((site) =>
        hasPageCredentials(sent(site), "t", cookie),
      ),
    ).toEqual([true, true, false, false]);
  });

  it("is no credential where only the bearer header is", () => {
    expect(hasBearer(request({ cookie: "nimbo-4100=k3y" }), "t")).toBe(false);
    expect(hasBearer(request({ authorization: "Bearer t" }), "t")).toBe(true);
  });
});
