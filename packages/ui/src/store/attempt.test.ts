// The page's report: an error saying the socket closed for good is kept by the session for its banner, never toasted;
// any other failure is a toast; an attempt resolves undefined on a failure.
import { NotebookNotFound, Unauthorized } from "@jsnb/core";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { attempter, usePageReport } from "./attempt.js";
import { useSessionStore } from "./socket.js";
import { useUiStore } from "./ui.js";

describe("usePageReport", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("keeps a 4401 refusal as the session's failure, once, with no toast", () => {
    const report = usePageReport();
    const first = new Unauthorized();
    report(first);
    report(new Unauthorized());
    expect(useSessionStore().failure).toBe(first);
    expect(useUiStore().toasts).toEqual([]);
  });

  it("toasts any other failure and keeps no failure", async () => {
    const attempt = attempter(usePageReport());
    const result = await attempt<number>(() =>
      Promise.reject(new NotebookNotFound({ path: "gone.jsnb" })),
    );
    expect(result).toBeUndefined();
    expect(useSessionStore().failure).toBeNull();
    expect(useUiStore().toasts.map((toast) => toast.title)).toEqual(["Notebook not open"]);
  });
});
