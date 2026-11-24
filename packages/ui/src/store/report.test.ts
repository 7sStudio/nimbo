// The error toast: a plain title, the catalogue name with the message, the action where one helps, and something sensible for a non-JsnbError.
import { protocolErrorNames } from "@jsnb/client";
import { ApiError, InterruptRefused, KernelDead } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { errorToast } from "./report.js";

describe("errorToast", () => {
  it("names the error and offers a restart for a refused interrupt", () => {
    const toast = errorToast(new InterruptRefused({ context: "Timeout" }));
    expect(toast).toMatchObject({ kind: "error", title: "Could not interrupt" });
    expect(toast.text?.startsWith("InterruptRefused: ")).toBe(true);
    expect(toast.action?.command).toBe("kernel.restart");
  });

  it("names an internal failure by the JsnbError it carries, with its action", () => {
    // as the client reads a -32603 answer: the protocol's name, the daemon's JsnbError named in data (03-api §7.6)
    const failed = (data: Record<string, unknown>) =>
      new ApiError(-32603, {
        name: protocolErrorNames[-32603] ?? "",
        message: "Could not save.",
        data,
      });
    expect(errorToast(failed({ name: "SaveFailed" }))).toMatchObject({
      title: "Could not save",
      text: "SaveFailed: Could not save.",
      action: { command: "notebook.save" },
    });
    expect(errorToast(failed({})).title).toBe("Internal failure");
  });

  it("spells out a name it has no title for, and has no action where none helps", () => {
    const toast = errorToast(new KernelDead({ exitCode: 1 }));
    expect(toast.title).toBe("Kernel dead");
    expect(toast.action).toBeUndefined();
  });

  it("reads any other throw as text", () => {
    expect(errorToast(new Error("socket gone"))).toEqual({
      kind: "error",
      title: "Something went wrong",
      text: "socket gone",
    });
    expect(errorToast("plain").text).toBe("plain");
  });
});
