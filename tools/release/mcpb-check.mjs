// The MCP bundle as a client runs it (tools/release/check.sh): unpacked into a fresh folder, its manifest read, the
// declared command started with the declared arguments and environment (`${__dirname}` the unpacked folder,
// `${user_config.workspace}` the given folder, `node` this Node, as a client runs a node server on its own), then
// MCP initialize and tools/list over stdio. With nimbo installed, the answers must be nimbo's own server at `version`
// with its notebook tools; without it, the bundle's one tool that says how to install nimbo.
//
//   node tools/release/mcpb-check.mjs <bundle.mcpb> <workspace> installed <version> | missing
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [bundle, workspace, expect, version] = process.argv.slice(2);
if (bundle === undefined || workspace === undefined || !["installed", "missing"].includes(expect)) {
  throw new Error("usage: mcpb-check.mjs <bundle.mcpb> <workspace> installed <version> | missing");
}
const fail = (message) => {
  console.error(`MCPB CHECK FAILED: ${message}`);
  process.exit(1);
};

const dir = mkdtempSync(join(tmpdir(), "nimbo-mcpb-check-"));
try {
  execFileSync("unzip", ["-q", bundle, "-d", dir]);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const config = manifest.server?.mcp_config;
  if (manifest.server?.type !== "node" || config?.command !== "node")
    fail("not a node server run by node");
  const values = { __dirname: dir, "user_config.workspace": workspace };
  const substitute = (text) =>
    text.replace(
      /\$\{([^}]+)\}/gu,
      (whole, key) => values[key] ?? fail(`unknown variable ${whole}`),
    );
  const args = (config.args ?? []).map(substitute);
  const env = Object.fromEntries(
    Object.entries(config.env ?? {}).map(([k, v]) => [k, substitute(v)]),
  );
  const answers = await speak(
    process.execPath,
    args,
    { ...process.env, ...env },
    expect === "missing",
  );
  const [init, list, call] = answers;
  const info = init?.result?.serverInfo;
  const names = (list?.result?.tools ?? []).map((tool) => tool.name);
  if (expect === "installed") {
    if (info?.name !== "nimbo" || info.version !== version || info.title !== manifest.description) {
      fail(`serverInfo is ${JSON.stringify(info)}`);
    }
    for (const tool of [
      "cell_run",
      "notebook_get",
      "cell_outputQuery",
      "packages_add",
      "debug_setBreakpoint",
    ]) {
      if (!names.includes(tool)) fail(`tools/list has no ${tool}`);
    }
    const declared = manifest.tools.map((tool) => tool.name);
    const missing = declared.filter((name) => !names.includes(name));
    if (missing.length > 0)
      fail(`the manifest lists tools the server does not: ${missing.join(", ")}`);
    console.log(`with nimbo: nimbo ${info.version}, ${names.length} tools`);
  } else {
    if (names.join() !== "nimbo_setup") fail(`tools/list is ${names.join()}`);
    const text = call?.result?.content?.[0]?.text ?? "";
    if (!text.includes("install.sh | sh") || !text.includes("brew install"))
      fail(`nimbo_setup says ${text}`);
    if (!init?.result?.instructions?.includes("not installed"))
      fail("initialize does not say nimbo is missing");
    console.log("without nimbo: one tool, nimbo_setup, naming both ways to install it");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/** Starts the server, sends initialize, tools/list (and a call of nimbo_setup), and gathers the answers by id. */
function speak(command, args, env, callSetup) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd: "/", stdio: ["pipe", "pipe", "inherit"] });
    const answers = [];
    let buffer = "";
    const wanted = callSetup ? 3 : 2;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no answer in 30 s (got ${answers.length})`));
    }, 30_000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.trim() === "") continue;
        const message = JSON.parse(line);
        if (typeof message.id === "number") answers[message.id - 1] = message;
        if (answers.filter(Boolean).length === wanted) child.stdin.end();
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`the server exited with ${code}`));
      else resolve(answers);
    });
    const send = (message) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "mcpb-check", version: "0" },
      },
    });
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/list" });
    if (callSetup)
      send({ id: 3, method: "tools/call", params: { name: "nimbo_setup", arguments: {} } });
  });
}
