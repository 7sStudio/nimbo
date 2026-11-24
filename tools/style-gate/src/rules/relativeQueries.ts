// jsnb/relative-queries: a container query sizes in relative units, as every length of the package does.
// Stylelint's unit-disallowed-list reads @media queries but not @container ones.
import { gateRule } from "./rule.js";

const absolute = /(?<![\w.-])[+-]?(?:\d*\.)?\d+(?:px|pt|pc|cm|mm|in|q)(?![\w-])/iu;

export const relativeQueries = gateRule("relative-queries", (root, report) => {
  root.walkAtRules("container", (query) => {
    if (absolute.test(query.params)) {
      report(query, `@container ${query.params} sizes in absolute units`);
    }
  });
});
