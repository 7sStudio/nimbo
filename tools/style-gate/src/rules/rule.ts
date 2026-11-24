// A custom rule of the gate (../config.ts), built as Stylelint builds its own, so its faults come out of Stylelint with
// theirs. The gate keeps one only where no Stylelint rule can say what 08 §7 says.
import type { Node, Root } from "postcss";
import stylelint from "stylelint";

/** Reports `fault` on `node`. */
export type Report = (node: Node, fault: string) => void;

/** The Stylelint plugin of rule `jsnb/<name>`, which hands `check` the sheet and a way to report a fault. */
export function gateRule(
  name: string,
  check: (root: Root, report: Report) => void,
): stylelint.Plugin {
  const ruleName = `jsnb/${name}`;
  const messages = stylelint.utils.ruleMessages(ruleName, {
    rejected: (fault: string) => fault,
  });
  const rule: stylelint.Rule = Object.assign(
    () => (root: Root, result: stylelint.PostcssResult) => {
      check(root, (node, fault) => {
        stylelint.utils.report({ ruleName, result, node, message: messages.rejected(fault) });
      });
    },
    { ruleName, messages },
  );
  return stylelint.createPlugin(ruleName, rule);
}
