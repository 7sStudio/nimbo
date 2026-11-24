// A local release server for the smoke and end-to-end checks: serves a release root (download/v<version>/…) on
// 127.0.0.1 in GitHub's layout, `latest/download/<file>` being the given version's files, and prints its port.
//
//   node tools/release/serve.mjs <release root> <latest version>
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
let latest = process.argv[3] ?? "";

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  // POST /latest <version> moves "latest" without a restart, as publishing a new release does.
  if (request.method === "POST" && url.pathname === "/latest") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      latest = body.trim();
      response.writeHead(204).end();
    });
    return;
  }
  const path = url.pathname.replace(/^\/latest\/download\//u, `/download/v${latest}/`);
  const file = normalize(join(root, decodeURIComponent(path)));
  if (!file.startsWith(`${root}/`) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-length": String(statSync(file).size) });
  createReadStream(file).pipe(response);
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`${String(server.address().port)}\n`);
});
