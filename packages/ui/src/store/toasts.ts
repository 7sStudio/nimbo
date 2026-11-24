// The toast stack: at most three, bottom right, each gone after 6 s unless the pointer rests on it.
// The same toast twice renews the one on screen. A toast may carry one action, a command id the Toasts component dispatches (Undo → undo.restore).
import type { Ref } from "vue";
import { ref } from "vue";

type ToastKind = "info" | "success" | "error";

export type ToastAction = {
  readonly label: string;
  readonly command: string;
  readonly args?: Readonly<Record<string, unknown>>;
};

export type Toast = {
  readonly id: number;
  readonly kind: ToastKind;
  readonly title: string;
  readonly text?: string;
  readonly action?: ToastAction;
};

export type NewToast = Omit<Toast, "id">;

const toastLimit = 3;
export const toastMs = 6000;

export type ToastQueue = {
  readonly toasts: Readonly<Ref<readonly Toast[]>>;
  /** Shows a toast, dropping the oldest beyond three; returns its id. */
  readonly toast: (toast: NewToast) => number;
  readonly dismiss: (id: number) => void;
  /** Stops a toast's clock (pointer over it) and restarts it with the full 6 s (pointer gone). */
  readonly pause: (id: number) => void;
  readonly resume: (id: number) => void;
};

/** One 6 s clock per toast: `arm` (re)starts it, `stop` takes it away, `expire` runs when it rings. */
function clocks(expire: (id: number) => void) {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const stop = (id: number) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
  };
  const arm = (id: number) => {
    stop(id);
    timers.set(
      id,
      setTimeout(() => {
        expire(id);
      }, toastMs),
    );
  };
  return { stop, arm };
}

/** True when `toast` says what `shown` says; a toast with an action (Undo) is always its own. */
const sameNews = (shown: Toast, toast: NewToast): boolean =>
  shown.action === undefined &&
  toast.action === undefined &&
  shown.kind === toast.kind &&
  shown.title === toast.title &&
  shown.text === toast.text;

export function toastQueue(): ToastQueue {
  const toasts = ref<readonly Toast[]>([]);
  let next = 1;
  const dismiss = (id: number) => {
    stop(id);
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  };
  const { stop, arm } = clocks(dismiss);

  return {
    toasts,
    toast: (toast) => {
      // the same news again (a key pressed twice, three stores refused alike) renews the toast on screen
      const same = toasts.value.find((each) => sameNews(each, toast));
      if (same !== undefined) {
        arm(same.id);
        return same.id;
      }
      const id = next++;
      const kept = toasts.value.slice(-(toastLimit - 1));
      for (const dropped of toasts.value.filter((each) => !kept.includes(each))) stop(dropped.id);
      toasts.value = [...kept, { ...toast, id }];
      arm(id);
      return id;
    },
    dismiss,
    pause: stop,
    resume: (id) => {
      if (toasts.value.some((toast) => toast.id === id)) arm(id);
    },
  };
}
