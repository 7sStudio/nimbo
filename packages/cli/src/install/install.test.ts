// The install logic `upgrade` and `uninstall` stand on (02-architecture §10): which release an upgrade takes, which
// old versions stay because a real process runs from them (found with the real `ps`), and the manifest and checksum
// checks over bytes read from disk and from a real local HTTP server.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { profileMarker, uninstallPlan, withoutProfileLine } from "./uninstallPlan.js";
import { assertVersionPath, sweepVersions } from "./local.js";
import { fetchBytes, parseManifest, ReleaseMissing, sha256Of, verifyArtefact } from "./manifest.js";
import {
  compareVersions,
  isReleaseVersion,
  planUpgrade,
  staleVersions,
  versionsInUse,
} from "./versions.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nimbo-install-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe("the release an upgrade takes", () => {
  it("orders versions as semver does, a prerelease before its release", () => {
    const sorted = [
      "0.10.0",
      "0.2.0",
      "1.0.0-rc.2",
      "1.0.0",
      "1.0.0-rc.10",
      "0.2.0-beta",
      "v0.9.1",
    ].sort(compareVersions);
    expect(sorted).toEqual([
      "0.2.0-beta",
      "0.2.0",
      "v0.9.1",
      "0.10.0",
      "1.0.0-rc.2",
      "1.0.0-rc.10",
      "1.0.0",
    ]);
  });

  it("installs only a newer release unless one is asked for by name", () => {
    expect(planUpgrade("0.1.0", "0.2.0", false)).toEqual({ kind: "install", version: "0.2.0" });
    expect(planUpgrade("0.2.0", "0.2.0", false)).toEqual({ kind: "current", version: "0.2.0" });
    expect(planUpgrade("0.2.0", "0.1.0", false)).toEqual({ kind: "current", version: "0.2.0" });
    expect(planUpgrade("0.2.0", "0.1.0", true)).toEqual({ kind: "install", version: "0.1.0" });
    expect(planUpgrade("0.2.0", "0.2.0", true)).toEqual({ kind: "current", version: "0.2.0" });
  });
});

describe("the versions an upgrade keeps", () => {
  it("keeps the current one and every one a process runs from, and removes the rest", () => {
    const inUse = versionsInUse(
      ["/data/nimbo/versions", "/private/data/nimbo/versions"],
      [
        {
          pid: 10,
          command:
            "/data/nimbo/versions/0.1.0/node/bin/node /data/nimbo/versions/0.1.0/app/dist/main.js open",
        },
        { pid: 11, command: "/data/nimbo/versions/0.1.0/node/bin/node kernel.js" },
        { pid: 12, command: "vim /data/nimbo/versions/.unpack-0.3.0-x/notes" },
        { pid: 13, command: "/private/data/nimbo/versions/0.2.0/node/bin/node main.js mcp" },
        { pid: 14, command: "tail -f /data/nimbo/versions/0.3.0/LICENSE" },
        { pid: 15, command: "/data/nimbo/versions/0.3.0/node/bin/nodemon x" },
        { pid: 16, command: "/data/nimbo/versions/../evil/node/bin/node x" },
        { pid: 99, command: "/data/nimbo/versions/0.0.9/node/bin/node (this process)" },
      ],
      99,
    );
    expect(inUse).toEqual(
      new Map([
        ["0.1.0", [10, 11]],
        ["0.2.0", [13]],
      ]),
    );
    expect(
      staleVersions(["0.0.8", "0.0.9", "0.1.0", "0.2.0", "0.3.0"], "0.3.0", new Set(inUse.keys())),
    ).toEqual({
      remove: ["0.0.8", "0.0.9"],
      kept: ["0.1.0", "0.2.0"],
    });
  });
});

describe("the versions a real process runs from", () => {
  it("keeps a version a real process runs from until that process ends, then removes it", async () => {
    const data = await scratch();
    for (const version of ["0.1.0", "0.2.0", "0.3.0"]) {
      await mkdir(join(data, "versions", version, "node", "bin"), { recursive: true });
    }
    await mkdir(join(data, "versions", ".unpack-0.4.0-abc"));
    const node = join(data, "versions", "0.1.0", "node", "bin", "node");
    await symlink(process.execPath, node);
    // a process whose command line is the old version's Node, as a daemon from it is
    const child: ChildProcess = spawn(node, ["-e", "setTimeout(() => {}, 60_000)"], {
      stdio: "ignore",
    });
    cleanups.push(async () => {
      child.kill("SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await new Promise((resolve) => child.once("spawn", resolve));
    const first = await sweepVersions(data, "0.3.0");
    expect(first.removed).toEqual(["0.2.0"]);
    expect([...first.kept.keys()]).toEqual(["0.1.0"]);
    expect(first.kept.get("0.1.0")).toEqual([child.pid]);
    const ended = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await ended;
    const second = await sweepVersions(data, "0.3.0");
    expect(second).toEqual({ removed: ["0.1.0"], kept: new Map() });
    expect((await readdir(join(data, "versions"))).sort()).toEqual([".unpack-0.4.0-abc", "0.3.0"]);
  });
});

describe("a Node started through an alias of the data folder", () => {
  it("counts by its real executable, not the path it was started by", async () => {
    const data = await scratch();
    const bin = join(data, "versions", "0.1.0", "node", "bin");
    await mkdir(bin, { recursive: true });
    await mkdir(join(data, "versions", "0.2.0"));
    await copyFile(process.execPath, join(bin, "node"), constants.COPYFILE_FICLONE);
    await chmod(join(bin, "node"), 0o755);
    const alias = join(await scratch(), "alias");
    await symlink(data, alias);
    const child = spawn(
      join(alias, "versions", "0.1.0", "node", "bin", "node"),
      ["-e", "setTimeout(() => {}, 60_000)"],
      {
        stdio: "ignore",
      },
    );
    cleanups.push(async () => {
      child.kill("SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await new Promise((resolve) => child.once("spawn", resolve));
    const swept = await sweepVersions(data, "0.2.0");
    expect(swept.removed).toEqual([]);
    expect(swept.kept.get("0.1.0")).toEqual([child.pid]);
  });
});

const tarball = new TextEncoder().encode("not really a tarball, but bytes all the same");
const manifest = {
  name: "nimbo",
  version: "0.2.0",
  commit: "abc1234",
  targets: {
    "darwin-arm64": {
      file: "nimbo-0.2.0-darwin-arm64.tar.gz",
      size: tarball.byteLength,
      sha256: sha256Of(tarball),
    },
  },
};

describe("the manifest and the checksums", () => {
  it("reads a manifest and accepts exactly the bytes it describes, from a folder and over HTTP", async () => {
    const dir = await scratch();
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
    await writeFile(join(dir, "nimbo-0.2.0-darwin-arm64.tar.gz"), tarball);
    const server = createServer((request, response) => {
      const body = request.url === "/manifest.json" ? JSON.stringify(manifest) : undefined;
      if (body === undefined) response.writeHead(404).end();
      else response.writeHead(200).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () =>
        new Promise((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    );
    const { port } = server.address() as AddressInfo;
    for (const url of [
      join(dir, "manifest.json"),
      `file://${dir}/manifest.json`,
      `http://127.0.0.1:${String(port)}/manifest.json`,
    ]) {
      expect(parseManifest(await fetchBytes(url), url)).toEqual(manifest);
    }
    await expect(fetchBytes(`http://127.0.0.1:${String(port)}/gone.json`)).rejects.toThrow(
      ReleaseMissing,
    );
    await expect(fetchBytes(join(dir, "gone.json"))).rejects.toThrow(ReleaseMissing);
    const artefact = manifest.targets["darwin-arm64"];
    const bytes = await fetchBytes(join(dir, artefact.file));
    expect(() => {
      verifyArtefact(bytes, artefact, "here");
    }).not.toThrow();
  });
});

describe("the manifest and the checksums, refused", () => {
  it("refuses a download one byte off, of another length, or a manifest of another shape", () => {
    const artefact = manifest.targets["darwin-arm64"];
    const tampered = tarball.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    expect(() => {
      verifyArtefact(tampered, artefact, "u");
    }).toThrow(/does not match its checksum/u);
    expect(() => {
      verifyArtefact(tarball.slice(1), artefact, "u");
    }).toThrow(/is incomplete/u);
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    expect(() =>
      parseManifest(encode({ ...manifest, targets: { x: { ...artefact, sha256: "zz" } } }), "u"),
    ).toThrow(/expected shape/u);
    expect(() =>
      parseManifest(encode({ ...manifest, targets: { x: { ...artefact, file: "../evil" } } }), "u"),
    ).toThrow(/expected shape/u);
    expect(() => parseManifest(new TextEncoder().encode("<html>"), "u")).toThrow(/not JSON/u);
  });
});

describe("the profile line", () => {
  it("removes the installer's two lines and nothing else", () => {
    const profile = `export A=1\n\n${profileMarker}\nexport PATH="$HOME/.local/bin:$PATH"\nalias ll='ls -l'\n`;
    expect(withoutProfileLine(profile)).toBe("export A=1\nalias ll='ls -l'\n");
    expect(withoutProfileLine("export B=2\n")).toBe("export B=2\n");
  });
});

describe("the versions that may name a folder", () => {
  it("takes digits, dots and a pre-release, and nothing a path could be built from", () => {
    for (const good of ["0.1.0", "10.20.30", "1.0.0-rc.1", "1.0.0-beta-2"]) {
      expect(isReleaseVersion(good)).toBe(true);
    }
    for (const bad of [
      "v0.1.0",
      "x/../../canary",
      "../../victim",
      "0.1",
      "1.0.0+build",
      "1.0.0-",
      "1.0.0-a..b",
      "1.0.0/x",
      "1.0.0 x",
      "",
    ]) {
      expect(isReleaseVersion(bad)).toBe(false);
    }
  });

  it("refuses a manifest whose version or file would leave the versions folder", () => {
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    const artefact = manifest.targets["darwin-arm64"];
    for (const version of ["x/../../canary", "../../victim", "0.2.0/.."]) {
      expect(() => parseManifest(encode({ ...manifest, version }), "u")).toThrow(/expected shape/u);
    }
    for (const file of ["..", "nimbo-0.2.0-darwin-arm64.tar.gz/..", "x.tar.gz"]) {
      expect(() =>
        parseManifest(
          encode({ ...manifest, targets: { "darwin-arm64": { ...artefact, file } } }),
          "u",
        ),
      ).toThrow(/expected shape/u);
    }
  });
});

describe("the folders an install may change", () => {
  it("changes only direct version folders of the versions folder", () => {
    expect(() => {
      assertVersionPath("/d", "/d/versions/0.2.0");
    }).not.toThrow();
    for (const path of [
      "/d/canary",
      "/d/versions",
      "/d/versions/x/../../canary",
      "/d/versions/0.2.0/app",
      "/d/versions/.unpack-1",
    ]) {
      expect(() => {
        assertVersionPath("/d", path);
      }).toThrow(/Refused to change/u);
    }
  });
});

const facts = {
  dataDir: "/d",
  versions: [
    { version: "0.1.0", size: 100 },
    { version: "0.2.0", size: 200 },
  ],
  duckdb: 0,
  bin: "/h/.local/bin/nimbo",
  owned: true,
  profiles: ["/h/.zshrc"],
  configDir: "/h/.config/nimbo",
  purge: false,
  registrations: [{ agent: "claude-code" as const, scope: "user", command: "/h/.local/bin/nimbo" }],
  removeMcp: true,
};
const paths = (items: readonly { path?: string }[]) => items.map((item) => item.path ?? "");

describe("the uninstall plan", () => {
  it("removes the versions, the link, the PATH line and the registrations, and keeps settings and workspaces", () => {
    const plan = uninstallPlan(facts);
    expect(paths(plan.remove)).toEqual([
      "/d/versions/0.1.0",
      "/d/versions/0.2.0",
      "/h/.local/bin/nimbo",
      "/h/.zshrc",
      "",
    ]);
    expect(plan.keep.map((item) => item.label)).toEqual([
      "your settings",
      "every workspace and its .jsnb/ folder",
    ]);
  });
});

describe("the uninstall plan with other choices", () => {
  it("moves the settings, a foreign command and kept registrations to the side they belong", () => {
    const plan = uninstallPlan({
      ...facts,
      purge: true,
      owned: false,
      removeMcp: false,
      duckdb: 5,
    });
    expect(paths(plan.remove)).toEqual([
      "/d/versions/0.1.0",
      "/d/versions/0.2.0",
      "/d/duckdb",
      "/h/.zshrc",
      "/h/.config/nimbo",
    ]);
    expect(plan.keep.map((item) => item.label)).toEqual([
      "a command that is not this install's link",
      "the MCP registration in Claude Code (user scope)",
      "every workspace and its .jsnb/ folder",
    ]);
  });
});

describe("a slow download", () => {
  it("takes longer than the idle limit in all when each chunk comes within it, and fails when one does not", async () => {
    const body = new Uint8Array(6000).fill(7);
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-length": String(body.length) });
      let at = 0;
      const pause = request.url === "/stalls" ? 600 : 80;
      const tick = (): void => {
        if (at >= body.length) {
          response.end();
          return;
        }
        response.write(body.subarray(at, at + 1000));
        at += 1000;
        setTimeout(tick, pause);
      };
      tick();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () =>
        new Promise((resolve) =>
          server.close(() => {
            resolve();
          }),
        ),
    );
    const { port } = server.address() as AddressInfo;
    const seen: number[] = [];
    const bytes = await fetchBytes(`http://127.0.0.1:${String(port)}/slow`, {
      idleMs: 300,
      onProgress: (received) => seen.push(received),
    });
    expect(bytes).toEqual(body);
    expect(seen.at(-1)).toBe(6000);
    await expect(
      fetchBytes(`http://127.0.0.1:${String(port)}/stalls`, { idleMs: 300 }),
    ).rejects.toThrow(/stopped sending/u);
  });
});
