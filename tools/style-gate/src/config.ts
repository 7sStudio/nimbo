// The gate's Stylelint configuration: the repository's rules for the package's CSS files (stylelint.config.js, as
// stylelint.resolveConfig() gives them for one of those files), the two of them compiled CSS needs more of merged in,
// the Stylelint rules compiled CSS adds, and the gate's own three. A rule the repository stops setting is an error,
// not a gap.
import type { Config } from "stylelint";

import { inItsPlace } from "./rules/inItsPlace.js";
import { inScope } from "./rules/inScope.js";
import { pageAtRules, pageLevel } from "./rules/pageLevel.js";
import { relativeQueries } from "./rules/relativeQueries.js";
import type { GateScope } from "./scope.js";

/** The repository's rules taken as they stand. */
const reused = ["color-no-hex", "color-named", "declaration-no-important"];
/** The repository's rules compiled CSS needs more of, merged below. */
const merged = ["unit-disallowed-list", "declaration-property-value-disallowed-list"];

/** No absolute unit but px; px also on strokes (the minifier writes stroke-width: 2 as 2px) and on
 * Tailwind's shadow and ring internals, which carry the outlines and bars the repository's own list allows. */
const units = ["pt", "pc", "cm", "mm", "in", "q"];
const px = ["stroke-width", "/^--tw-(?:inset-)?(?:shadow|ring)/"];
/** An outline of no width is an outline removed too. */
const values: Readonly<Record<string, readonly string[]>> = {
  outline: ["/^0(?:px)?(?:\\s|$)/"],
  "outline-style": ["none"],
  "outline-width": ["/^0(?:px)?$/"],
};

/** The Stylelint rules compiled CSS adds, which the views' utilities can break and the CSS files do not. */
const added = {
  // a color is a token or color-mix() of tokens: no literal color function, which color-no-hex and color-named miss
  "function-disallowed-list": "rgb rgba hsl hsla hwb lab lch oklab oklch color".split(" "),
  "declaration-property-value-allowed-list": {
    "z-index": ["/^var\\(--z-(?:toolbar|panel|overlay|toast)\\)$/"],
  },
  // :focus-visible is the one focus style; :focus and :focus-within light on a pointer's focus too
  "selector-pseudo-class-disallowed-list": ["focus", "focus-within"],
  "jsnb/in-scope": true,
  "jsnb/in-its-place": true,
  "jsnb/relative-queries": true,
};

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function listOf(value: unknown, what: string): readonly unknown[] {
  if (!isList(value)) throw new Error(`stylelint.config.js: ${what} is not a list`);
  return value;
}
function recordOf(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`stylelint.config.js: ${what} is not an object`);
  return value;
}

/** The repository's unit-disallowed-list, [units, { ignoreProperties }] as resolveConfig() gives it (a single unit
 * stands alone), with `units` and the `px` exceptions added. */
function withUnits(setting: unknown): unknown[] {
  const [disallowed, options = {}] = listOf(setting, "unit-disallowed-list");
  const secondary = recordOf(options, "unit-disallowed-list's options");
  const ignored = recordOf(secondary.ignoreProperties ?? {}, "its ignoreProperties");
  const allowed = listOf(ignored.px ?? [], "its px exceptions");
  const repository =
    typeof disallowed === "string"
      ? [disallowed]
      : listOf(disallowed, "unit-disallowed-list's units");
  return [
    [...repository, ...units],
    { ...secondary, ignoreProperties: { ...ignored, px: [...allowed, ...px] } },
  ];
}

/** The repository's declaration-property-value-disallowed-list, [{ property: values }] as resolveConfig() gives it,
 * with `values` added. */
function withValues(setting: unknown): unknown[] {
  const [primary] = listOf(setting, "declaration-property-value-disallowed-list");
  const repository = recordOf(primary, "declaration-property-value-disallowed-list's values");
  const more = Object.entries(values).map(([prop, list]) => [
    prop,
    [...listOf(repository[prop] ?? [], `its ${prop}`), ...list],
  ]);
  return [{ ...repository, ...Object.fromEntries(more) }];
}

/** The gate's configuration from the repository's, resolved for a CSS file of the package. */
export function gateConfig(repository: Config | undefined, scope: GateScope): Config {
  const rules = repository?.rules ?? {};
  const missing = [...reused, ...merged].filter(
    (name) => rules[name] === undefined || rules[name] === null,
  );
  if (missing.length > 0) {
    throw new Error(`stylelint.config.js no longer sets ${missing.join(", ")} for the package`);
  }
  const plugins = [
    repository?.plugins ?? [],
    inScope(scope),
    inItsPlace(scope),
    relativeQueries,
    pageLevel(scope),
  ];
  return {
    plugins: plugins.flat(),
    rules: {
      ...Object.fromEntries(reused.map((name) => [name, rules[name]])),
      "unit-disallowed-list": withUnits(rules["unit-disallowed-list"]),
      "declaration-property-value-disallowed-list": withValues(
        rules["declaration-property-value-disallowed-list"],
      ),
      ...added,
      // nothing that reaches the page: no @property, @scope or @starting-style, and @keyframes and @font-face only
      // in a page's own sheet, as jsnb/page-level allows them
      "at-rule-allowed-list": [
        "layer",
        "media",
        "supports",
        "container",
        ...(scope.page ? pageAtRules : []),
      ],
      ...(scope.page ? { "jsnb/page-level": true } : {}),
    },
  };
}
