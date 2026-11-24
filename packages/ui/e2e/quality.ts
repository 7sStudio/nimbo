// What the quality journeys share: the checks a person makes by looking, as
// assertions on the real page. Nothing is cut off or spills out of its container, the page never scrolls sideways, the
// cell headers' columns sit under the one column header, the rows of a panel share their left edge, the regions do not
// overlap, no icon is squeezed out of its square, and no error reaches the console. Each check runs in the page and answers the list of what it found, so a
// failure names the element.
import type { Page } from "@playwright/test";

import { expect, regionsLoaded, rest } from "./world.js";

/** Collects the page's console errors and uncaught errors from now on; `none` fails the journey on any. */
export function watchErrors(page: Page): { readonly none: () => void } {
  const seen: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") seen.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => seen.push(`page: ${String(error)}`));
  return {
    none: () => {
      expect(seen, "no console or page error").toEqual([]);
    },
  };
}

/** Elements of ours with text of their own that is wider than their box and neither scrolls nor ends in an
 * ellipsis; user output, the editor and the output viewer measure themselves. */
const clipped = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".jsnb-ui *")].flatMap((element) => {
      if (element.closest("[data-live], .cm-editor, .jsnb-ov, pre") !== null) return [];
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const own = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
      );
      const kept = style.textOverflow === "ellipsis" || /auto|scroll/u.test(style.overflowX);
      const spills = element.scrollWidth > element.clientWidth + 1;
      return box.width > 2 && own && spills && !kept && style.display !== "inline"
        ? [`"${element.innerText.trim().slice(0, 40)}" is cut off`]
        : [];
    }),
  );

/** Elements of ours that reach outside the window, and a page that scrolls sideways or as a whole. */
const outside = (page: Page) =>
  page.evaluate(() => {
    const wide =
      document.documentElement.scrollWidth > innerWidth ? ["the page scrolls sideways"] : [];
    // the shell fills the window and only its panes scroll: a document taller than the window lets a wheel past the
    // notebook's end push the whole app up (a hidden label positioned outside its scroller did that)
    const tall =
      document.documentElement.scrollHeight > innerHeight + 1 ? ["the whole app scrolls down"] : [];
    const out = [...document.querySelectorAll<HTMLElement>(".jsnb-ui *")].flatMap((element) => {
      if (element.closest("[data-live], .cm-editor, .jsnb-ov, pre") !== null) return [];
      const box = element.getBoundingClientRect();
      return box.width > 2 && box.height > 2 && (box.right > innerWidth + 1 || box.left < -1)
        ? [`"${element.innerText.trim().slice(0, 40)}" is outside the window`]
        : [];
    });
    return [...wide, ...tall, ...out];
  });

/** Cell headers whose columns do not start where the first cell header's do, or whose content runs into the next
 * one. */
const misaligned = (page: Page) =>
  page.evaluate(() => {
    const left = (element: Element) => Math.round(element.getBoundingClientRect().left);
    const heads = [...document.querySelectorAll('[data-part="head"]')];
    const starts = [...(heads[0]?.children ?? [])].map(left);
    return heads.flatMap((row, at) => {
      const cells = [...row.children];
      const off = cells.flatMap((cell, column) =>
        Math.abs(left(cell) - (starts[column] ?? 0)) > 1
          ? [`cell ${String(at + 1)} column ${String(column + 1)}`]
          : [],
      );
      const runs = cells.slice(0, -1).flatMap((cell, column) => {
        const next = cells[column + 1]?.getBoundingClientRect().left ?? 0;
        const inner = [...cell.querySelectorAll("*")].some((each) => {
          const box = each.getBoundingClientRect();
          // the focused cell's number sits in a square that hangs 5 px (0.3125rem) into the next column's own padding
          return box.width > 2 && box.right > next + 6;
        });
        return inner
          ? [`cell ${String(at + 1)} column ${String(column + 1)} runs into the next`]
          : [];
      });
      return [...off, ...runs];
    });
  });

/** Lists of a panel whose rows do not share their left edge, and regions that overlap. */
const uneven = (page: Page) =>
  page.evaluate(() => {
    const lists = [
      ...document.querySelectorAll(
        "#side :is(ul, ol), #inspector :is(ul, ol), #preview :is(ul, ol), #bottom ul",
      ),
    ];
    const ragged = lists.flatMap((list) => {
      const edges = new Set(
        [...list.children].map((row) => Math.round(row.getBoundingClientRect().left)),
      );
      return edges.size > 1
        ? [`the rows of "${list.getAttribute("aria-label") ?? "a list"}" are ragged`]
        : [];
    });
    const regions = ["side", "page", "inspector", "preview", "bottom"].flatMap((id) => {
      const element = document.getElementById(id);
      return element === null ? [] : [{ id, box: element.getBoundingClientRect() }];
    });
    const overlaps = regions.flatMap((a) =>
      regions.flatMap((b) =>
        a.id < b.id &&
        a.box.left < b.box.right - 1 &&
        b.box.left < a.box.right - 1 &&
        a.box.top < b.box.bottom - 1 &&
        b.box.top < a.box.bottom - 1
          ? [`${a.id} overlaps ${b.id}`]
          : [],
      ),
    );
    return [...ragged, ...overlaps];
  });

/** Icons of ours drawn narrower or flatter than they are tall or wide (a button's padding squeezing its icon): every
 * icon of the page is square. */
const squeezed = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<SVGElement>(".jsnb-ui svg.lucide")].flatMap((icon) => {
      if (icon.closest("[data-live]") !== null) return [];
      const box = icon.getBoundingClientRect();
      const label =
        icon.closest("[aria-label]")?.getAttribute("aria-label") ?? icon.getAttribute("class");
      return box.width > 0 && box.height > 0 && Math.abs(box.width - box.height) > 1
        ? [
            `the icon of "${label ?? "?"}" is squeezed to ${String(box.width)} by ${String(box.height)}`,
          ]
        : [];
    }),
  );

/** Home's rows whose columns do not start where the list's column header's do (the icon and the key hint aside). */
const homeMisaligned = (page: Page) =>
  page.evaluate(() => {
    const left = (element: Element) => Math.round(element.getBoundingClientRect().left);
    const head = document.querySelector('[data-part="home-columns"]');
    if (head === null) return ["no column header on Home"];
    const starts = [...head.children].slice(1, 6).map(left);
    // the list's own rows: the folder picker's are options of another listbox
    const rows = '[data-testid="notebooks"] [role="option"]:not(:has(input))';
    return [...document.querySelectorAll(rows)].flatMap((row) =>
      [...row.children]
        .slice(1, 6)
        .flatMap((cell, at) =>
          Math.abs(left(cell) - (starts[at] ?? 0)) > 1
            ? [`row ${row.getAttribute("data-path") ?? "?"} column ${String(at + 2)}`]
            : [],
        ),
    );
  });

/** Waits until the page is at rest: the pointer away, the regions loaded, every entrance ended. */
async function settled(page: Page): Promise<void> {
  await rest(page);
  await regionsLoaded(page);
  // a block that has just entered (a markdown cell's editor) is measured once its entrance has ended, not mid-scale
  await page.evaluate(async () => {
    const ending = document
      .getAnimations()
      .filter((each) => each.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(ending.map((each) => each.finished.catch(() => null)));
  });
}

/** The Home page as it stands holds every rule: nothing cut off, nothing outside, its rows under the column header,
 * the panels' rows even, no icon squeezed. */
export async function homeSound(page: Page, state: string): Promise<void> {
  await settled(page);
  const found = [
    ...(await clipped(page)),
    ...(await outside(page)),
    ...(await homeMisaligned(page)),
    ...(await uneven(page)),
    ...(await squeezed(page)),
  ];
  expect([...new Set(found)], `the Home page is sound: ${state}`).toEqual([]);
}

/** The page as it stands holds every rule: nothing cut off, nothing outside, columns aligned, rows even. `state`
 * names it in the failure. */
export async function sound(page: Page, state: string): Promise<void> {
  await settled(page);
  const found = [
    ...(await clipped(page)),
    ...(await outside(page)),
    ...(await misaligned(page)),
    ...(await uneven(page)),
    ...(await squeezed(page)),
  ];
  expect([...new Set(found)], `the layout is sound: ${state}`).toEqual([]);
}
