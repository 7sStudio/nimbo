// What cell.snapshot's HTML may hold (agentSnapshot.ts): elements by namespace and local name, attributes by name,
// URLs by scheme. Anything not listed here is left out.

const htmlNs = "http://www.w3.org/1999/xhtml";
const svgNs = "http://www.w3.org/2000/svg";

const words = (text: string): ReadonlySet<string> => new Set(text.split(/\s+/u).filter(Boolean));

/** Gone with everything inside them, in any namespace: code, raw text, embedded documents and SVG's scripted parts. */
const dropped =
  words(`script style template noscript noembed noframes xmp plaintext iframe frame frameset object
  embed applet param base link meta title audio video source track portal math foreignobject use animate set
  animatemotion animatetransform image feimage filter handler listener`);

const htmlElements =
  words(`a abbr address article aside b bdi bdo blockquote br button canvas caption cite code col
  colgroup data dd del details dfn div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header
  hgroup hr i img input ins kbd label legend li main mark meter nav ol optgroup option output p pre progress q rp
  rt ruby s samp section select small span strong sub summary sup table tbody td textarea tfoot th thead time tr u
  ul var wbr`);

const svgElements =
  words(`svg g defs symbol path rect circle ellipse line polyline polygon text tspan desc
  lineargradient radialgradient stop clippath mask pattern marker`);

const voids = words("br col hr img input wbr");

const globalAttributes = words("id class title lang dir role hidden");

const htmlAttributes: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries({
    a: words("href target rel"),
    img: words("src alt width height"),
    td: words("colspan rowspan headers scope abbr"),
    th: words("colspan rowspan headers scope abbr"),
    col: words("span"),
    colgroup: words("span"),
    input: words("type name disabled readonly placeholder min max step size multiple"),
    button: words("type name value disabled"),
    select: words("name multiple disabled size"),
    option: words("value disabled label"),
    optgroup: words("label disabled"),
    label: words("for"),
    progress: words("value max"),
    meter: words("value min max low high optimum"),
    time: words("datetime"),
    data: words("value"),
    ol: words("start reversed type"),
    li: words("value"),
    textarea: words("name rows cols placeholder disabled readonly"),
    details: words("open"),
    canvas: words("width height"),
    del: words("datetime"),
    ins: words("datetime"),
    output: words("for name"),
    fieldset: words("disabled name"),
    form: words("name"),
  }),
);

const svgAttributes =
  words(`viewbox width height x y x1 x2 y1 y2 cx cy r rx ry fx fy d points transform fill stroke
  stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity fill-opacity
  fill-rule clip-rule opacity text-anchor dominant-baseline alignment-baseline font-size font-family font-weight
  font-style letter-spacing dx dy rotate offset stop-color stop-opacity gradientunits gradienttransform
  spreadmethod patternunits patterncontentunits patterntransform clippathunits maskunits maskcontentunits
  markerwidth markerheight refx refy orient markerunits preserveaspectratio clip-path mask marker-start
  marker-mid marker-end visibility display`);

const urlAttributes = words("href src");
const safeSchemes = words("http https mailto");

/** Whether the element and what it holds are left out. */
export const droppedWithContent = (element: Element): boolean =>
  dropped.has(element.localName.toLowerCase()) ||
  (element.namespaceURI !== htmlNs && element.namespaceURI !== svgNs);

/** "emit" an allowlisted element, "unwrap" an unknown HTML or SVG one (its children only), "skip" anything else. */
export function emittedElement(element: Element): "emit" | "unwrap" | "skip" {
  const name = element.localName.toLowerCase();
  if (element.namespaceURI === htmlNs) return htmlElements.has(name) ? "emit" : "unwrap";
  if (element.namespaceURI === svgNs) return svgElements.has(name) ? "emit" : "unwrap";
  return "skip";
}

export const isVoid = (element: Element): boolean =>
  element.namespaceURI === htmlNs && voids.has(element.localName);

/** A URL the page could open, as the URL parser reads it: tabs, newlines, controls and spaces do not hide a scheme. */
export function safeUrl(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- the C0 controls are what the URL parser strips
  const bare = value.replace(/[\u0000- \u007f]/gu, "");
  const scheme = /^([^/?#]*?):/u.exec(bare)?.[1];
  return scheme === undefined || safeSchemes.has(scheme.toLowerCase());
}

/** A paint value: plain, or a reference to an element of the page (`url(#gradient)`), never another resource. */
const safePaint = (value: string): boolean =>
  !value.toLowerCase().includes("url(") || /^\s*url\(\s*#[\w.-]+\s*\)\s*$/u.test(value);

export function allowedAttribute(element: Element, name: string, value: string): boolean {
  const key = name.toLowerCase();
  if (urlAttributes.has(key) && !safeUrl(value)) return false;
  if (globalAttributes.has(key) || /^(?:aria|data)-[\w.-]+$/u.test(key)) return true;
  if (element.namespaceURI === svgNs) return svgAttributes.has(key) && safePaint(value);
  return htmlAttributes.get(element.localName)?.has(key) === true;
}
