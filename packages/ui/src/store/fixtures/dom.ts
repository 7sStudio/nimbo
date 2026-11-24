// A DOM for the realm's Node tests. The daemon runs only in Node's environment (its modules read files by
// import.meta.url), and runtime-web reads the page's globals when it loads, so importing this file first installs a
// happy-dom Window's globals for the whole test file; `pageDocument` is that window's document.
import { Window } from "happy-dom";
import { afterAll } from "vitest";

// Not Event: Node's own WebSocket dispatches its events through the global Event, which must stay Node's.
const names = ["window", "document", "HTMLElement", "Node", "Element"] as const;
const win = new Window({ url: "http://127.0.0.1/" });
const saved = names.map((name) => [name, Reflect.get(globalThis, name)] as const);
for (const name of names) {
  Reflect.set(globalThis, name, name === "window" ? win : Reflect.get(win, name));
}

afterAll(async () => {
  for (const [name, value] of saved) Reflect.set(globalThis, name, value);
  await win.happyDOM.close();
});

/** The installed window's document. */
export const pageDocument = (): Document => Reflect.get(globalThis, "document");
