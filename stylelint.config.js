// Stylelint for packages/**/*.{css,vue} per 08-code-standards §7: literal colors only in the token sheets, logical properties, no !important.
export default {
  extends: ["stylelint-config-standard"],
  ignoreFiles: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/vendor/**"],
  plugins: ["stylelint-use-logical"],
  overrides: [
    { files: ["**/*.vue"], customSyntax: "postcss-html" },
    // The shared palette is written once, as data, in packages/tokens, whose generated sheets carry it (their :root and.
    // jsnb-ov blocks, bare oklch hues); ui's tokens.css adds the page's own (a translucent red, the floating shadow) and
    // output-view's theme.css the ANSI colors of streams. These are the only places a color may be literal (08 §7).
    // output-view and ui size everything in relative units: px only for strokes,
    // the 1 px hairlines, outlines and shadows (focus rings, the active row's bar). Lengths a spec gives in px, as
    // outputs.maxHeightPx, become CSS at the TypeScript boundary, never as a number here.
    {
      files: ["packages/output-view/**/*.{css,vue}", "packages/ui/**/*.{css,vue}"],
      rules: {
        "unit-disallowed-list": [
          ["px"],
          {
            ignoreProperties: {
              px: ["/^border(?!.*radius)/", "/^outline/", "box-shadow", "--shadow"],
            },
          },
        ],
      },
    },
    {
      files: [
        "packages/tokens/src/page.css",
        "packages/tokens/src/viewer.css",
        "packages/ui/src/theme/tokens.css",
        "packages/output-view/src/theme.css",
      ],
      rules: {
        "color-no-hex": null,
        "color-named": null,
        "no-duplicate-selectors": null,
        "hue-degree-notation": "number",
        "custom-property-empty-line-before": null,
      },
    },
  ],
  rules: {
    "csstools/use-logical": "always",
    "color-no-hex": true,
    "color-named": "never",
    "declaration-no-important": true,
    "declaration-property-value-disallowed-list": { outline: ["none", "0"] },
    "at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: [
          "theme",
          "layer",
          "apply",
          "utility",
          "variant",
          "custom-variant",
          "source",
          "plugin",
          "config",
          "reference",
        ],
      },
    ],
    // Tailwind's @import "x" layer(y) and @theme inline need the at-rule preludes left alone.
    "import-notation": null,
    "at-rule-prelude-no-invalid": null,
    "at-rule-descriptor-no-unknown": null,
    "font-family-name-quotes": "always-where-recommended",
    // Prettier owns blank lines (08 §1).
    "at-rule-empty-line-before": null,
    // Tailwind's @custom-variant and @utility bodies are nested rules whose & is the utility itself, so they have no
    // scoping root here (the ui prose utility, theme/prose.css).
    "nesting-selector-no-missing-scoping-root": [
      true,
      { ignoreAtRules: ["custom-variant", "utility"] },
    ],
  },
};
