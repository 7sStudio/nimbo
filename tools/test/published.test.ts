// Tests the check: no public workspace package depends at run time on a private one, and the checker finds
// such a dependency in dependencies and peerDependencies but allows it in devDependencies.
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { privateDependencies, workspaceManifests } from "./published.js";

describe("the workspace's published packages", () => {
  it("depend at run time on no private workspace package", () => {
    const manifests = workspaceManifests(fileURLToPath(new URL("../../", import.meta.url)));
    expect(manifests.map((m) => m.name)).toContain("@jsnb/output-view");
    expect(privateDependencies(manifests)).toEqual([]);
  });
});

describe("privateDependencies", () => {
  const core = { name: "@jsnb/core", private: true };
  it("names a public package's dependency or peer dependency on a private one", () => {
    const view = {
      name: "@jsnb/view",
      dependencies: { "@jsnb/core": "workspace:*", vue: "^3" },
      peerDependencies: { "@jsnb/core": "*" },
    };
    expect(privateDependencies([core, view])).toEqual([
      "@jsnb/view → @jsnb/core (dependencies)",
      "@jsnb/view → @jsnb/core (peerDependencies)",
    ]);
  });

  it("allows a dev dependency on it, and any dependency of a private package", () => {
    const bundled = { name: "@jsnb/view", devDependencies: { "@jsnb/core": "workspace:*" } };
    const app = { name: "@jsnb/ui", private: true, dependencies: { "@jsnb/core": "workspace:*" } };
    expect(privateDependencies([core, bundled, app])).toEqual([]);
  });
});
