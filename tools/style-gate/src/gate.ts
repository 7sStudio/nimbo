// @jsnb/style-gate: 08 §7 on a compiled stylesheet, a package's built CSS, whose rules are mostly its views' Tailwind
// utilities, which Stylelint never sees in the CSS files it lints. Stylelint itself runs on it, with the repository's
// rules for the package's CSS files and what compiled CSS adds (config.ts), on the sheet as prepare.ts reads it.
import stylelint from "stylelint";
import type { Config } from "stylelint";

import { gateConfig } from "./config.js";
import { prepared } from "./prepare.js";
import type { GateScope } from "./scope.js";

export type { GateScope } from "./scope.js";

/** One fault: the Stylelint rule that refuses it and what it says. */
export type Fault = { readonly rule: string; readonly text: string };

/** Where the repository's rules come from. */
export type Repository = {
  /** A CSS file of the package: the gate reuses the rules stylelint.config.js gives it. */
  readonly file: string;
  /** A configuration to resolve for `file` instead of the one Stylelint finds (the gate's own tests). */
  readonly config?: Config;
};

/**
 * The gate for one package: every fault of a stylesheet against 08 §7. The sheet is linted as code with no filename,
 * because the repository ignores dist/** and a named dist file would come back ignored with no warnings; disable
 * comments in it are ignored, and a sheet Stylelint still ignores is a fault.
 */
export function styleGate(
  scope: GateScope,
  repository: Repository,
): (css: string) => Promise<Fault[]> {
  let config: Promise<Config> | undefined;
  const resolve = async (): Promise<Config> =>
    gateConfig(
      await stylelint.resolveConfig(
        repository.file,
        repository.config === undefined ? {} : { config: repository.config },
      ),
      scope,
    );
  return async (css) => {
    config ??= resolve();
    const { results } = await stylelint.lint({
      code: prepared(css, scope.defaults, scope.page !== undefined),
      config: await config,
      ignoreDisables: true,
    });
    return results.flatMap((result) => [
      ...(result.ignored === true
        ? [{ rule: "ignored", text: "Stylelint ignored the sheet" }]
        : []),
      ...result.invalidOptionWarnings.map(({ text }) => ({ rule: "configuration", text })),
      ...result.warnings.map(({ rule, text }) => ({ rule, text })),
    ]);
  };
}
