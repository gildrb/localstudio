import type { ESTree } from "@oxlint/plugins";

import { parameterAnnotation, parameterVisitors, type ParameterOwner } from "../shared/ast.ts";

function parameterName(parameter: ESTree.ParamPattern, sourceText: string): string {
  if (parameter.type === "TSParameterProperty") {
    return parameterName(parameter.parameter, sourceText);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameterName(parameter.left, sourceText);
  }
  if (parameter.type === "RestElement") {
    return parameterName(parameter.argument, sourceText);
  }
  return parameter.type === "Identifier"
    ? parameter.name
    : sourceText.replace(/\s*:\s*unknown\s*$/u, "");
}

import { antiSlopRule } from "../shared/rule.ts";

export const noUnknownParametersRule = antiSlopRule(
  "unknownParameter",
  "Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.",
  (context) => {
    const checkParameters = (node: ParameterOwner) => {
      for (const parameter of node.params) {
        const annotation = parameterAnnotation(parameter);
        if (annotation?.typeAnnotation.type !== "TSUnknownKeyword") continue;
        const name = parameterName(parameter, context.sourceCode.getText(parameter));
        if (name === "cause") continue;
        context.report({
          node: annotation.typeAnnotation,
          messageId: "unknownParameter",
          data: { parameter: name },
        });
      }
    };

    return parameterVisitors(checkParameters);
  },
);
