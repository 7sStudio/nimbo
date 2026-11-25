// Tests cell.snapshot's reading of a container in Chromium: the text (a chart's SVG labels, a progress bar, hidden parts,
// scripts and styles left out), the cut at a character boundary, the budgets on a deep tree, and the HTML's allowlist:
// each hostile shape a page can build, parsed again in a document, runs nothing and holds nothing executable.
import { afterEach, describe, expect, it } from "vitest";

import { agentSnapshot } from "./agentSnapshot.js";

// the hostile shapes are built in this page too: their payloads call it, and count nothing until reparse replaces it
Reflect.set(window, "__hit", () => undefined);

const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const each of mounted.splice(0)) each.remove();
});

function container(html = ""): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  mounted.push(root);
  return root;
}

const read = (root: Element, maxBytes = 100_000) => agentSnapshot(root, { maxBytes, html: true });

describe("agentSnapshot's text", () => {
  it("reads a chart's labels one per line, a progress bar, and leaves hidden parts, scripts and styles out", async () => {
    const root = container(
      '<svg><text x="0" y="10">North 120</text><text x="0" y="30">South 80</text><script>var a = 1</script><style>.x{}</style></svg>' +
        '<progress max="30" value="12"></progress><span style="display:none">gone</span>' +
        '<span aria-hidden="true">icon</span><button aria-label="Close"></button><style>p { color: red }</style>',
    );
    const { text } = await agentSnapshot(root, { maxBytes: 1000, html: false });
    expect(text).toBe("North 120\nSouth 80\n[12/30] Close");
  });

  it("cuts html and text at maxBytes without splitting a character, and says so", async () => {
    const root = container("<p>héllo 😀 world</p>");
    const shot = await read(root, 10);
    expect(shot.truncated).toBe(true);
    expect(shot.text).toBe("héllo ");
    expect(new TextEncoder().encode(shot.html).length).toBeLessThanOrEqual(10);
    expect(await read(root)).toEqual({
      html: "<p>héllo 😀 world</p>",
      text: "héllo 😀 world",
      truncated: false,
    });
  });

  it("stops at its budgets on a 50 000 deep tree, hidden or in a template, without failing", async () => {
    const root = container("<div hidden></div><template></template>");
    const template = root.children[1];
    if (!(template instanceof HTMLTemplateElement)) throw new Error("no template");
    for (const top of [root.children[0], template.content]) {
      let at: Node | undefined = top;
      for (let i = 0; i < 50_000 && at; i++) at = at.appendChild(document.createElement("div"));
      at?.appendChild(document.createTextNode("deep"));
    }
    const shot = await read(root);
    expect(shot.truncated).toBe(true);
    expect(shot.text).not.toContain("deep");
  });
});

/** Parses `html` as a page would, in a same-origin frame's document (scripts run there) and through innerHTML;
 * answers how many payloads ran and the frame's document. */
async function reparse(html: string): Promise<{ readonly ran: number; readonly doc: Document }> {
  let ran = 0;
  Reflect.set(window, "__hit", () => (ran += 1));
  const frame = document.createElement("iframe");
  const loaded = new Promise((resolve) => {
    frame.addEventListener("load", resolve, { once: true });
  });
  frame.srcdoc = `<!doctype html><body>${html}</body>`;
  document.body.append(frame);
  mounted.push(frame);
  await loaded;
  const holder = document.createElement("div");
  holder.innerHTML = html;
  await new Promise((resolve) => setTimeout(resolve, 200));
  const doc = frame.contentDocument;
  if (!doc) throw new Error("no frame document");
  return { ran, doc };
}

const executableTags =
  "script, style, iframe, object, embed, base, link, meta, use, foreignObject, animate, set, math";
const scriptedAttributes = new Set(["style", "srcset", "srcdoc"]);

/** What an attribute could run or load: an event handler, a style or source set, a URL of another scheme. */
function attributeRisk(element: Element, { name, value }: Attr): string | undefined {
  if (name.startsWith("on") || scriptedAttributes.has(name)) return `${element.localName}[${name}]`;
  // eslint-disable-next-line no-control-regex -- the C0 controls the URL parser strips
  const bare = value.replace(/[\u0000-\u0020\u007f]/gu, "").toLowerCase();
  const scheme = /^([^/?#]*?):/u.exec(bare)?.[1];
  return scheme !== undefined && !["http", "https", "mailto"].includes(scheme)
    ? `${element.localName}[${name}=${scheme}:]`
    : undefined;
}

/** Anything in `doc` that could run code or load another document. */
function executable(doc: Document): string[] {
  const found = [...doc.body.querySelectorAll(executableTags)].map((element) => element.localName);
  for (const element of doc.body.querySelectorAll("*"))
    for (const attribute of element.attributes) {
      const risk = attributeRisk(element, attribute);
      if (risk !== undefined) found.push(risk);
    }
  return found;
}

const hit = "top.__hit()";

/** The hostile shapes, each built as a page's code could build it. */
function hostile(): HTMLElement {
  const root = container(
    `<svg><script>${hit}</script><style>@import "x"</style><text>chart</text>` +
      `<animate attributeName="href" values="javascript:${hit}"></animate><use href="data:image/svg+xml,<svg/>"></use>` +
      `<foreignObject><img src="x" onerror="${hit}"></foreignObject><a href="javascript:${hit}"><text>l</text></a></svg>` +
      `<a href="data:text/html,x">d</a><a href="vbscript:x">v</a><iframe src="data:text/html,x"></iframe>` +
      `<object data="javascript:${hit}"></object><embed src="javascript:${hit}"><img srcset="javascript:x 1x" src="x.png">` +
      `<base href="javascript:${hit}//"><div style="background:url(javascript:${hit})">s</div>` +
      `<math><mtext><img src="x" onerror="${hit}"></mtext></math><span title='"><img src=x onerror=${hit}>'>t</span>` +
      `<p onclick="${hit}">p</p>`,
  );
  for (const name of ["noembed", "xmp", "iframe", "noscript", "style"]) {
    const raw = document.createElement(name);
    raw.append(document.createTextNode(`</${name}><img src=x onerror=${hit}>`));
    root.append(raw);
  }
  root.append(document.createComment(`--><img src=x onerror=${hit}>`));
  root.append(document.createTextNode(`<img src=x onerror=${hit}>`));
  for (const hidden of [
    "java\tscript",
    "java\nscript",
    "java\u0001script",
    "java\u0000script",
    " JAVASCRIPT",
  ]) {
    const link = document.createElement("a");
    link.setAttribute("href", `${hidden}:${hit}`);
    link.textContent = "x";
    root.append(link);
  }
  const area = document.createElement("textarea");
  area.value = `</textarea><img src=x onerror=${hit}>`;
  root.append(area);
  return root;
}

describe("agentSnapshot's HTML", () => {
  it("holds nothing executable from any hostile shape and runs nothing when parsed again", async () => {
    const shot = await read(hostile());
    const { ran, doc } = await reparse(shot.html ?? "");
    expect(ran).toBe(0);
    expect(executable(doc)).toEqual([]);
    expect(shot.text).not.toContain("@import");
    expect(shot.html).toContain("<text>chart</text>");
  });

  it("keeps allowed links and form state, and masks a typed password", async () => {
    const root = container(
      '<a href="https://example.com/a">a</a><a href="/rel">b</a><a href="mailto:x@y.z">c</a>' +
        '<input id="n"><input type="password" id="p"><input type="hidden" value="h"><input type="checkbox" id="c">',
    );
    const by = (id: string) => root.querySelector<HTMLInputElement>(`#${id}`);
    const [name, password, box] = [by("n"), by("p"), by("c")];
    if (!name || !password || !box) throw new Error("inputs missing");
    name.value = "Ada";
    password.value = "hunter2";
    box.checked = true;
    const { html } = await read(root);
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('href="/rel"');
    expect(html).toContain('href="mailto:x@y.z"');
    expect(html).toContain('value="Ada"');
    expect(html).toContain('type="password" id="p" value="***"');
    expect(html).toContain('type="hidden" value="h"');
    expect(html).toContain('type="checkbox" id="c" checked=""');
    expect(html).not.toContain("hunter2");
  });
});

describe("agentSnapshot's HTML under its budget", () => {
  it("cuts a huge attribute or text to the budget without reading it whole", async () => {
    const root = container("<p></p>");
    const huge = "a".repeat(20_000_000);
    root.firstElementChild?.setAttribute("title", huge);
    root.append(document.createTextNode(huge));
    const started = performance.now();
    const shot = await read(root, 4096);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(shot.truncated).toBe(true);
    expect(new TextEncoder().encode(shot.html).length).toBeLessThanOrEqual(4096);
    expect(new TextEncoder().encode(shot.text).length).toBeLessThanOrEqual(4096);
  });

  it("is well formed at every cut: markup appended after it stays outside", async () => {
    const root = container(
      '<div><p title="a &quot;quoted&quot; title">some <b>bold</b> text</p><textarea></textarea><ul><li>one</li></ul></div>',
    );
    const area = root.querySelector("textarea");
    if (!area) throw new Error("no textarea");
    area.value = "</textarea> typed text that runs on";
    for (let maxBytes = 1; maxBytes <= 200; maxBytes += 1) {
      const { html } = await read(root, maxBytes);
      expect(new TextEncoder().encode(html).length).toBeLessThanOrEqual(maxBytes);
      const parsed = document.createElement("template");
      parsed.innerHTML = `${html}<i id="after">after</i>`;
      expect(parsed.content.lastElementChild?.id).toBe("after");
    }
  });
});

describe("agentSnapshot's HTML and the network", () => {
  it("drops CSS escapes and remote URLs from SVG paint, and notes a remote image as text", async () => {
    const root = container(
      '<svg><rect fill="u\\72 l(https://x.test/a)" stroke="url(https://x.test/b)" mask="url(#m)" clip-path="u\\rl(#m)"></rect>' +
        '<circle fill="#0af" stroke="currentColor"></circle></svg>' +
        '<img src="https://x.test/a.png" alt="logo"><img src="//x.test/b.png" alt="b"><img src="local.png" alt="l">' +
        '<a href="https://x.test/page">link</a>',
    );
    const { html } = await read(root);
    expect(html).not.toContain("\\");
    expect(html).not.toMatch(/(?:src|fill|stroke)="[^"]*x\.test/u);
    expect(html).toContain('<rect mask="url(#m)"></rect>');
    expect(html).toContain('<circle fill="#0af" stroke="currentColor"></circle>');
    expect(html).toContain("[image: logo][image: b]");
    expect(html).toContain('<img src="local.png" alt="l">');
    expect(html).toContain('<a href="https://x.test/page">link</a>');
  });
});
