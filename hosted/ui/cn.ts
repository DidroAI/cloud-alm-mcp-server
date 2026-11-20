import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge must know the kit's own scale names (styles.css), or it
 * reads `text-small` as a colour and drops it next to `text-ink`. The kit
 * has no corner radii (every box is square), so there is no radius scale.
 */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "numeral",
        "micro",
        "tag",
        "caption",
        "small",
        "body",
        "lead",
        "heading",
        "metric-sm",
        "subtitle",
        "metric",
        "title",
        "greeting",
      ],
      shadow: ["popover", "overlay", "panel", "lift", "focus", "active-bar"],
      tracking: ["title", "section", "greeting", "numeral"],
      "font-weight": ["label", "quiet"],
    },
  },
});

/** Joins class names; later Tailwind classes win over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
