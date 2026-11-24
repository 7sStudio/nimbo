// A local port that refuses connections, for the retry tests: the OS picks a free one, which is then released.
import { createServer } from "node:net";

export function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address !== null && typeof address === "object" ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}
