// cn: merges class lists with clsx and resolves conflicts between the page's ui:-prefixed utilities with tailwind-merge,
// told the page's own scale (main.css) so a type size and a color never read as one group.
import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
  prefix: "ui",
  extend: {
    theme: {
      text: ["kbd", "tiny", "meta", "small", "code", "ui", "title", "prose", "h1", "h2", "h3"],
      leading: ["ui", "code"],
      radius: ["small", "control", "card", "pill"],
      shadow: ["card", "pop"],
      animate: ["enter", "progress"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
