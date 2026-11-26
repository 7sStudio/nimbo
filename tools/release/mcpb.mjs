// The MCP bundle and its MCP Registry listing: nimbo-mcp-<version>.mcpb, one bundle for every
// platform, holding manifest.json, the launcher (mcp-registry/launcher.mjs as server/index.mjs) and the icon; the client
// runs the launcher with its own Node, and the launcher runs the nimbo installed on the machine. The manifest lists the
// tools the built MCP server serves (`packages/mcp/dist`, so the packages must be built). The official MCPB CLI
// validates and packs it; server.json, beside it, is the registry entry with the bundle's release URL and SHA-256.
// build.mjs calls it for a release folder; the release workflow publishes what one runner built.
//
//   node tools/release/mcpb.mjs <release folder> [--version <v>]
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { productName, productVersion } from "../../packages/core/src/product.ts";
import {
  listingDescription,
  listingTitle,
  listingWebsite,
} from "../../packages/mcp/src/server/listing.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const here = join(root, "tools/release/mcp-registry");
const config = JSON.parse(readFileSync(join(root, "tools/release/config.json"), "utf8"));
/** The listing's name in the MCP Registry: GitHub's spelling of the organisation, which the registry compares as is. */
const registryName = "io.github.7sStudio/nimbo";
const registrySchema =
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

export const bundleName = (version) => `${productName}-mcp-${version}.mcpb`;

/** The tools the built MCP server lists, asked over stdio in an empty folder (tools/list reaches no daemon). */
function listedTools() {
  const folder = mkdtempSync(join(tmpdir(), "nimbo-mcpb-tools-"));
  try {
    const requests = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "mcpb-build", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ];
    const answer = spawnSync(process.execPath, [join(root, "packages/mcp/dist/main.js")], {
      cwd: folder,
      input: requests.map((r) => JSON.stringify(r)).join("\n") + "\n",
      encoding: "utf8",
    });
    const listed = answer.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line))
      .find((message) => message.id === 2)?.result?.tools;
    if (!Array.isArray(listed) || listed.length === 0) {
      throw new Error(
        `the built MCP server listed no tools (is packages/mcp built?)\n${answer.stderr}`,
      );
    }
    return listed.map(({ name, description }) => ({
      name,
      description: firstSentence(description),
    }));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const firstSentence = (text = "") => {
  const end = text.search(/\.(\s|$)/u);
  return end === -1 ? text : text.slice(0, end + 1);
};

function manifest(version, tools) {
  return {
    manifest_version: "0.3",
    name: productName,
    display_name: productName,
    version,
    description: listingTitle,
    long_description:
      `${listingDescription} nimbo is a local notebook for JavaScript and TypeScript whose server cells run in a Node ` +
      "kernel and client cells in the browser. This extension connects to the nimbo installed on your machine " +
      "(install it with `curl -fsSL https://github.com/7sStudio/nimbo/releases/latest/download/install.sh | sh` or " +
      "`brew install 7sStudio/nimbo/nimbo`); without it, its one tool explains how to install it. It never downloads " +
      "or installs anything itself.",
    author: { name: "7sStudio", url: "https://github.com/7sStudio" },
    repository: { type: "git", url: `${listingWebsite}.git` },
    homepage: listingWebsite,
    documentation: `${listingWebsite}/blob/main/packages/mcp/README.md`,
    support: `${listingWebsite}/issues`,
    icon: "icon.png",
    server: {
      type: "node",
      entry_point: "server/index.mjs",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/server/index.mjs"],
        env: { NIMBO_WORKSPACE: "${user_config.workspace}" },
      },
    },
    tools,
    tools_generated: true,
    keywords: [
      "notebook",
      "jupyter",
      "javascript",
      "typescript",
      "node",
      "repl",
      "sql",
      "jq",
      "debugger",
    ],
    license: config.license,
    compatibility: { platforms: ["darwin", "linux"], runtimes: { node: ">=18.0.0" } },
    user_config: {
      workspace: {
        type: "directory",
        title: "Workspace folder",
        description:
          "The folder whose notebooks the agent works on (nimbo's workspace: the nearest folder up that holds .jsnb/).",
        required: true,
        default: "${HOME}",
      },
    },
  };
}

function serverJson(version, sha256) {
  return {
    $schema: registrySchema,
    name: registryName,
    title: listingTitle,
    description: listingDescription,
    version,
    websiteUrl: listingWebsite,
    repository: { url: listingWebsite, source: "github" },
    packages: [
      {
        registryType: "mcpb",
        identifier: `${config.releases}/download/v${version}/${bundleName(version)}`,
        version,
        fileSha256: sha256,
        transport: { type: "stdio" },
      },
    ],
  };
}

/**
 * The official MCPB CLI at the pinned version, run from `cwd` (outside the checkout, whose npm settings are pnpm's);
 * its npm cache is `NIMBO_MCPB_CACHE` when set.
 */
function mcpb(cwd, args) {
  const cache = process.env.NIMBO_MCPB_CACHE;
  execFileSync("npm", ["exec", "--yes", `--package=${config.mcpb}`, "--", "mcpb", ...args], {
    cwd,
    stdio: ["ignore", "inherit", "inherit"],
    env: cache === undefined ? process.env : { ...process.env, npm_config_cache: cache },
  });
}

/** Writes the bundle and server.json into `dir`; returns their names. */
export function writeBundle(dir, version) {
  const stage = mkdtempSync(join(tmpdir(), "nimbo-mcpb-"));
  try {
    const bundle = join(stage, productName);
    mkdirSync(join(bundle, "server"), { recursive: true });
    copyFileSync(join(here, "launcher.mjs"), join(bundle, "server/index.mjs"));
    copyFileSync(join(here, "icon.png"), join(bundle, "icon.png"));
    copyFileSync(join(root, "LICENSE"), join(bundle, "LICENSE"));
    writeFileSync(
      join(bundle, "manifest.json"),
      `${JSON.stringify(manifest(version, listedTools()), null, 2)}\n`,
    );
    mcpb(stage, ["validate", join(bundle, "manifest.json")]);
    const file = bundleName(version);
    mcpb(stage, ["pack", bundle, join(dir, file)]);
    const sha256 = createHash("sha256")
      .update(readFileSync(join(dir, file)))
      .digest("hex");
    writeFileSync(
      join(dir, "server.json"),
      `${JSON.stringify(serverJson(version, sha256), null, 2)}\n`,
    );
    return { bundle: file, server: "server.json" };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { version: { type: "string", default: productVersion } },
    allowPositionals: true,
  });
  const dir = resolve(positionals[0] ?? "");
  const { bundle } = writeBundle(dir, values.version);
  console.log(`${bundle} and server.json in ${dir}`);
}
