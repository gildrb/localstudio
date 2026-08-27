import { defineRule } from "@oxlint/plugins";
import { isGlobalReflectMethodCall } from "../shared/reflect-method.ts";

function reflectRule(method: "apply" | "get", messageId: string, message: string) {
  return defineRule({
    meta: { type: "problem", messages: { [messageId]: message } },
    createOnce(context) {
      return {
        CallExpression(node) {
          if (
            node.callee.type !== "Super" &&
            node.callee.type !== "V8IntrinsicExpression" &&
            isGlobalReflectMethodCall(context.sourceCode, node.callee, method)
          )
            context.report({ node, messageId });
        },
      };
    },
  });
}

export const noReflectApplyRule = reflectRule(
  "apply",
  "reflectApply",
  "Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.",
);
export const noReflectGetRule = reflectRule(
  "get",
  "reflectGet",
  "Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.",
);
