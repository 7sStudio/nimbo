import { describe, expect, it } from "vitest";

import { productConfigDir, productDataDir, xdgDir } from "./product.js";

describe("the XDG rule", () => {
  it("takes an absolute value and ignores an unset, empty or relative one", () => {
    expect(xdgDir({ XDG_CONFIG_HOME: "/x/conf" }, "XDG_CONFIG_HOME", "/h")).toBe("/x/conf");
    for (const value of [undefined, "", "conf", "./conf", "~/conf"]) {
      expect(xdgDir({ XDG_CONFIG_HOME: value }, "XDG_CONFIG_HOME", "/h")).toBe("/h/.config");
      expect(xdgDir({ XDG_DATA_HOME: value }, "XDG_DATA_HOME", "/h")).toBe("/h/.local/share");
    }
  });

  it("places the config and data folders by it, and the config folder under APPDATA on Windows", () => {
    expect(productConfigDir({ XDG_CONFIG_HOME: "rel" }, "/h", "linux")).toBe("/h/.config/nimbo");
    expect(productConfigDir({ XDG_CONFIG_HOME: "/c" }, "/h", "darwin")).toBe("/c/nimbo");
    expect(productDataDir({ XDG_DATA_HOME: "/d" }, "/h")).toBe("/d/nimbo");
    expect(productConfigDir({ APPDATA: "C:\\A" }, "C:\\h", "win32")).toBe("C:\\A\\nimbo");
    expect(productConfigDir({}, "C:\\h", "win32")).toBe("C:\\h\\AppData\\Roaming\\nimbo");
  });
});
