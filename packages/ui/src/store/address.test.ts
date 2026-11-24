// The page's address read from location: the notebook page under core's notebookName, the output tab, the Home page,
// and neither; a notebook's page address from Home.
import { notebookName, notebookPageName } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { homePageUrl, notebookPageUrl, pageAddress } from "./address.js";

const at = (pathname: string, search = "?token=t0k") => ({
  origin: "http://127.0.0.1:4000",
  pathname,
  search,
});

describe("pageAddress", () => {
  it("reads the notebook and the token of /ui/<name>, the name core gives the page", () => {
    expect(pageAddress(at("/ui/demo"))).toEqual({
      url: "http://127.0.0.1:4000",
      token: "t0k",
      notebook: "demo.jsnb",
    });
    for (const ref of ["sub dir/demo.jsnb", "a/b/c%.jsnb", "ünï.jsnb"]) {
      expect(pageAddress(at(`/ui/${notebookName(ref)}`, ""))).toMatchObject({
        notebook: ref,
        token: "",
      });
    }
  });

  it("reads the output tab's execution and index, the name before them", () => {
    expect(pageAddress(at("/ui/sub/demo/out/x_abc/2"))).toMatchObject({
      notebook: "sub/demo.jsnb",
      output: { execution: "x_abc", index: 2 },
    });
  });

  it("reads a path that only looks like an output tab as a notebook's", () => {
    expect(pageAddress(at("/ui/a/out/x/1.5"))?.notebook).toBe("a/out/x/1.5.jsnb");
    expect(pageAddress(at("/ui/a/out/x"))?.notebook).toBe("a/out/x.jsnb");
  });

  it("reads the page of a notebook inside a folder named out as that notebook's, never an output tab", () => {
    for (const ref of ["a/out/x/1.jsnb", "out/x_abc/2.jsnb", "a/b/out/x_abc/0.jsnb"]) {
      const page = pageAddress(at(`/ui/${notebookPageName(ref)}`));
      expect([ref, page?.notebook, page?.output]).toEqual([ref, ref, undefined]);
    }
    expect(pageAddress(at(`/ui/${notebookPageName("a/out.jsnb")}/out/x_abc/3`))).toMatchObject({
      notebook: "a/out.jsnb",
      output: { execution: "x_abc", index: 3 },
    });
  });
});

describe("pageAddress for the Home page", () => {
  it("reads /ui and /ui/ as the Home page, with its token", () => {
    for (const path of ["/ui", "/ui/"]) {
      expect(pageAddress(at(path))).toEqual({
        url: "http://127.0.0.1:4000",
        token: "t0k",
        notebook: "",
        home: true,
      });
    }
  });

  it("gives a notebook's page address with the same query, its name core's", () => {
    expect(notebookPageUrl("sub dir/demo.jsnb", { search: "?token=t0k" })).toBe(
      "/ui/sub%20dir/demo?token=t0k",
    );
    expect(notebookPageUrl("a/out/x/1.jsnb", { search: "" })).toBe("/ui/a/%6Fut/x/1");
  });

  it("gives the Home page's address with the same query, from any page", () => {
    expect(homePageUrl({ search: "?token=t0k" })).toBe("/ui/?token=t0k");
    expect(homePageUrl({ search: "" })).toBe("/ui/");
  });

  it("refuses what is not a page", () => {
    for (const path of ["/", "/n/demo/x", "/ui/%E0%A4%A"]) {
      expect(pageAddress(at(path))).toBeUndefined();
    }
  });
});
