// The MCP bundle's entry (02-architecture §10): the MCP client runs it with its own Node. It finds the nimbo installed
// on this machine and runs `nimbo mcp` in the workspace folder the user chose, on the client's stdin and stdout. When
// nimbo is not installed, or the folder is not there, it serves a small MCP server of its own whose one tool says what
// is missing and how to install nimbo; it never downloads or installs anything. No dependencies: the bundle is this
// file and its manifest.
import { spawn } from "node:child_process";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";

const home = homedir();
const install = [
  "curl -fsSL https://github.com/7sStudio/nimbo/releases/latest/download/install.sh | sh",
  "brew install 7sStudio/nimbo/nimbo",
];

const isRunnable = (path) => {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const isFolder = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Where the installer put its link, from its record (it may be outside ~/.local/bin). */
function recordedLink() {
  const xdg = process.env.XDG_DATA_HOME;
  const data = join(
    xdg !== undefined && isAbsolute(xdg) ? xdg : join(home, ".local/share"),
    "nimbo",
  );
  try {
    const { bin } = JSON.parse(readFileSync(join(data, "install.json"), "utf8"));
    return typeof bin === "string" && isAbsolute(bin) ? [bin] : [];
  } catch {
    return [];
  }
}

/**
 * The installed `nimbo`: on PATH first, then where the installer and Homebrew put it, since a desktop client often
 * starts its servers with a short PATH that holds none of them.
 */
function findNimbo(env = process.env) {
  const onPath = (env.PATH ?? "")
    .split(delimiter)
    .filter((dir) => isAbsolute(dir))
    .map((dir) => join(dir, "nimbo"));
  const known = [
    ...recordedLink(),
    join(home, ".local/bin/nimbo"),
    "/opt/homebrew/bin/nimbo",
    "/usr/local/bin/nimbo",
    "/home/linuxbrew/.linuxbrew/bin/nimbo",
    join(home, ".linuxbrew/bin/nimbo"),
  ];
  return [...onPath, ...known].find(isRunnable);
}

/** The workspace folder: the bundle's setting, else the home folder. */
function workspaceOf(env = process.env) {
  const chosen = env.NIMBO_WORKSPACE?.trim();
  // A host that substitutes nothing for an unset setting may pass the placeholder through as it is.
  return chosen === undefined || chosen === "" || chosen.startsWith("${") ? home : chosen;
}

const protocolVersions = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const toolName = "nimbo_setup";

/** A minimal MCP server on stdio that explains `problem` and its `remedy` through one read-only tool, until stdin ends. */
function explain(problem, remedy) {
  const text = `${problem}\n\nnimbo's notebook tools are not available. ${remedy}`;
  const send = (message) =>
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const answer = (method, params) => {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: protocolVersions.includes(params?.protocolVersion)
            ? params.protocolVersion
            : "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "nimbo", version: "0.0.0", title: "nimbo (not set up)" },
          instructions: text,
        };
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: [
            {
              name: toolName,
              title: "Set up nimbo",
              description: `Says why nimbo's notebook tools are not available and how to fix it: ${problem}`,
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
              annotations: { readOnlyHint: true, openWorldHint: false },
            },
          ],
        };
      case "tools/call":
        return params?.name === toolName
          ? { content: [{ type: "text", text }], isError: true }
          : undefined;
      default:
        return undefined;
    }
  };
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    if (message === null || typeof message !== "object" || message.id === undefined) return;
    const result = answer(message.method, message.params);
    if (result !== undefined) send({ id: message.id, result });
    else if (message.method === "tools/call") {
      send({
        id: message.id,
        error: { code: -32602, message: `Unknown tool: ${message.params?.name}` },
      });
    } else
      send({
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` },
      });
  });
  lines.on("close", () => process.exit(0));
}

/** Runs `nimbo mcp` in `cwd` on this process's stdio, passing signals on, and exits with its code. */
function run(nimbo, cwd) {
  const child = spawn(nimbo, ["mcp"], { cwd, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    process.stderr.write(`nimbo bundle: ${nimbo} mcp did not start: ${error.message}\n`);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}

const nimbo = findNimbo();
const workspace = workspaceOf();
if (nimbo === undefined) {
  explain(
    "nimbo is not installed on this machine (no nimbo on PATH, in ~/.local/bin or in Homebrew's bin folder).",
    `Install nimbo with one of:\n  ${install.join("\n  ")}\nthen restart this MCP server.`,
  );
} else if (!isFolder(workspace)) {
  explain(
    `The workspace folder ${workspace} does not exist.`,
    "Choose another folder in the extension's settings, then restart this MCP server.",
  );
} else {
  process.stderr.write(`nimbo bundle: ${nimbo} mcp in ${workspace}\n`);
  run(nimbo, workspace);
}
