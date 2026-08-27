import type { ESTree } from "@oxlint/plugins";
import { unwrapParenthesizedExpression } from "../shared/ast.ts";

function isEmptyObjectExpression(node: ESTree.Expression): boolean {
  return node.type === "ObjectExpression" && node.properties.length === 0;
}

function isConditionalEmptyObjectSpread(node: ESTree.Expression): boolean {
  const conditional = unwrapParenthesizedExpression(node);
  return (
    conditional.type === "ConditionalExpression" &&
    (isEmptyObjectExpression(conditional.consequent) ||
      isEmptyObjectExpression(conditional.alternate))
  );
}

import { antiSlopRule } from "../shared/rule.ts";

export const noConditionalEmptyObjectSpreadRule = antiSlopRule(
  "avoid",
  "This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.",
  (context) => {
    return {
      SpreadElement(node) {
        if (node.parent.type !== "ObjectExpression") return;

        if (isConditionalEmptyObjectSpread(node.argument)) {
          context.report({ node, messageId: "avoid" });
        }
      },
    };
  },
  { type: "suggestion" },
);
