// The kernel's pre-warm: Node loads some globals on their first touch, and a termination that lands
// inside such a load (a cell's first fetch, say) leaves the global broken for the life of the process (`performance`
// stays undefined). So the kernel touches them before `ready`: the ones its own code uses (performance, the Fetch
// classes behind route()) and the ones a cell commonly reaches for first (fetch, crypto, navigator, structuredClone).
// Globals that warn or need a flag (localStorage, sessionStorage) are left alone.

/** The Fetch machinery route() uses: a Request with a body read, a Response with Headers read. */
async function warmFetchClasses(): Promise<void> {
  const headers = new Headers({ "content-type": "text/plain" });
  await new Request("http://127.0.0.1/", { method: "POST", body: "warm", headers }).text();
  await new Response(new Uint8Array(1), { headers }).arrayBuffer();
  await (await fetch("data:text/plain,warm")).text();
}

/** Loads every lazily loaded global the kernel and a first cell would otherwise load under a possible termination. */
export async function warmUp(): Promise<void> {
  void performance.now();
  void globalThis.crypto.getRandomValues(new Uint8Array(1));
  void globalThis.crypto.randomUUID();
  void Reflect.get(globalThis.crypto, "subtle");
  void Reflect.get(globalThis.navigator, "userAgent");
  void structuredClone({ warm: [new Date(0), new Map()] });
  await warmFetchClasses();
}
