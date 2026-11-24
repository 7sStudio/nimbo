// Test helpers for the views: a viewer context that records what a view asks of its host, and a mount inside
// Reka's TooltipProvider (OutputView's job in the product) with reactive props a test can change.
import type { Path } from "@jsnb/core";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { TooltipProvider } from "reka-ui";
import type { Component } from "vue";
import { afterEach } from "vitest";
import { defineComponent, h, nextTick, reactive, ref } from "vue";

import type { HintContext } from "../../model/hints.js";
import type { Place, ViewerContext } from "../context.js";
import { viewerKey } from "../context.js";
import type { Tooltips } from "../tooltip.js";
import { useTooltips } from "../tooltip.js";
import type { CopyEvent, JumpTarget } from "../options.js";

// Every mounted view is unmounted after its test, so Reka's layers and listeners never leak into the next one.
enableAutoUnmount(afterEach);

// happy-dom lays nothing out, so every element would measure 0 × 0 and the virtual lists would show no row: give
// elements the size of a 640 × 400 output, the one a real page measures for a capped viewer (not in Chromium).
if (navigator.userAgent.includes("HappyDOM")) {
  for (const [name, size] of [
    ["offsetWidth", 640],
    ["offsetHeight", 400],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => size });
  }
}

/** 2026-10-12 10:00 UTC, the clock every hint test reads. */
const fixedNow = Date.UTC(2026, 9, 12, 10, 0, 0);

type ViewerCalls = {
  readonly copy: [CopyEvent["what"], string][];
  readonly jump: JumpTarget[];
  readonly loadMore: [Path, number][];
  readonly fullscreen: [unknown, Path][];
  /** The labels of the work run through the context, and the failures it reported. */
  readonly tasks: string[];
  readonly failures: string[];
};

/** `loadMore: false` leaves load more out, as a host without it does; `drills` is full screen's context. */
type RecordingViewerOptions = {
  readonly loadMore?: boolean;
  readonly hints?: Partial<HintContext>;
  readonly drills?: boolean;
  readonly place?: Place;
  /** The tooltips the views report to (default: a controller on the real clock). */
  readonly tips?: Tooltips;
};

/** A viewer context whose callbacks only record. */
function recordingViewer(options: RecordingViewerOptions = {}) {
  const calls: ViewerCalls = {
    copy: [],
    jump: [],
    loadMore: [],
    fullscreen: [],
    tasks: [],
    failures: [],
  };
  const context: ViewerContext = {
    theme: ref("dark"),
    hints: ref({ now: () => fixedNow, timeZone: "UTC", ...options.hints }),
    copy: (what, text) => {
      calls.copy.push([what, text]);
      return Promise.resolve();
    },
    jump: (target) => calls.jump.push(target),
    loadMore: ref(
      options.loadMore === false
        ? undefined
        : (path: Path, offset: number) => {
            calls.loadMore.push([path, offset]);
            return Promise.resolve();
          },
    ),
    run: async (label, work) => {
      calls.tasks.push(label);
      await work(new AbortController().signal);
    },
    fail: (message) => calls.failures.push(message),
    openFullscreen: (json, path) => calls.fullscreen.push([json, path]),
    drills: options.drills === true,
    place: ref(options.place),
    tips: options.tips ?? useTooltips(),
  };
  return { context, calls };
}

/** Mounts `component` with `props` inside a `.jsnb-ov` root (so the views' styles apply, as under OutputView), under a
 * TooltipProvider and the recording context, with `slots`; `state` changes the props. */
export function mountView<P extends Record<string, unknown>>(
  component: Component,
  props: P,
  viewer = recordingViewer(),
  slots: Record<string, (scope: never) => unknown> = {},
) {
  const state = reactive({ ...props });
  const root = defineComponent({
    setup: () => () =>
      h("div", { class: "jsnb-ov" }, [
        h(TooltipProvider, { delayDuration: 0 }, () => h(component, state, slots)),
      ]),
  });
  const wrapper = mount(root, {
    global: { provide: { [viewerKey]: viewer.context } },
    attachTo: document.body,
  });
  return { wrapper, state, calls: viewer.calls, view: wrapper.findComponent(component) };
}

export const settle = async (): Promise<void> => {
  await Promise.resolve();
  await nextTick();
};

/** Lets promises and Vue's updates settle until `check` passes (or fails for good after 50 rounds): what an awaited
 * host callback or engine needs, without vi.waitFor's 50 ms polling in a 50 ms test budget. */
export async function until(check: () => void): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    if (passes(check)) return;
    await flushPromises();
  }
  check();
}

function passes(check: () => void): boolean {
  try {
    check();
    return true;
  } catch {
    // Not yet: the next round lets more promises settle.
    return false;
  }
}
