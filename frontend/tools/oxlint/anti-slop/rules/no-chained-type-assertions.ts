import type { ESTree } from "@oxlint/plugins";
import {
  isConstAssertion,
  isTypeAssertion,
  unwrapParenthesizedExpression,
  type TypeAssertion,
} from "../shared/ast.ts";

function isOutermostAssertionInChain(node: TypeAssertion): boolean {
  let current: ESTree.Expression = node;
  let parent = node.parent;

  while (parent.type === "ParenthesizedExpression" && parent.expression === current) {
    current = parent;
    parent = parent.parent;
  }

  return !isTypeAssertion(parent) || parent.expression !== current;
}

function isForbiddenAssertionChain(node: TypeAssertion): boolean {
  let assertionCount = 0;
  let hasNonConstAssertion = false;
  let current: ESTree.Expression = node;

  while (isTypeAssertion(current)) {
    assertionCount += 1;
    hasNonConstAssertion ||= !isConstAssertion(current);
    current = unwrapParenthesizedExpression(current.expression);
  }

  return assertionCount > 1 && hasNonConstAssertion;
}

import { antiSlopRule } from "../shared/rule.ts";

export const noChainedTypeAssertionsRule = antiSlopRule(
  "chained",
  "This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.",
  (context) => {
    const checkTypeAssertion = (node: TypeAssertion) => {
      if (!isOutermostAssertionInChain(node) || !isForbiddenAssertionChain(node)) return;
      context.report({ node, messageId: "chained" });
    };

    return {
      TSAsExpression: checkTypeAssertion,
      TSTypeAssertion: checkTypeAssertion,
    };
  },
);
