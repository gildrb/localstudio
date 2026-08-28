import { defineRule } from "@oxlint/plugins";
import type { Rule, RuleMeta } from "@oxlint/plugins";

type CreateOnce = Extract<Rule, { createOnce: unknown }>["createOnce"];

export function antiSlopRule(
  messageId: string,
  message: string,
  createOnce: CreateOnce,
  meta: Omit<RuleMeta, "messages"> = { type: "problem" },
): Rule {
  return defineRule({ meta: { ...meta, messages: { [messageId]: message } }, createOnce });
}
