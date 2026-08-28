import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

export type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;
export type ParameterOwner =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

export function isTypeAssertion(node: ESTree.Node): node is TypeAssertion {
  return node.type === "TSAsExpression" || node.type === "TSTypeAssertion";
}

export function unwrapParenthesizedExpression(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (current.type === "ParenthesizedExpression") current = current.expression;
  return current;
}

export function unwrapParenthesizedType(type: ESTree.TSType): ESTree.TSType {
  let current = type;
  while (current.type === "TSParenthesizedType") current = current.typeAnnotation;
  return current;
}

export function typeReferenceName(type: ESTree.TSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

export function referencedAliasName(type: ESTree.TSType): string | null {
  const value = unwrapParenthesizedType(type);
  if (value.type !== "TSTypeReference" || value.typeArguments?.params.length) return null;
  return typeReferenceName(value);
}

export function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    typeReferenceName(node.typeAnnotation) === "const"
  );
}

export function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

export function parameterAnnotation(
  parameter: ESTree.ParamPattern,
): ESTree.TSTypeAnnotation | null | undefined {
  if (parameter.type === "TSParameterProperty") return parameterAnnotation(parameter.parameter);
  if (parameter.type === "RestElement") {
    return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? parameter.left.typeAnnotation;
  }
  return parameter.typeAnnotation;
}

export function parameterVisitors(check: (node: ParameterOwner) => void) {
  return {
    ArrowFunctionExpression: check,
    FunctionDeclaration: check,
    FunctionExpression: check,
    TSCallSignatureDeclaration: check,
    TSConstructSignatureDeclaration: check,
    TSConstructorType: check,
    TSDeclareFunction: check,
    TSEmptyBodyFunctionExpression: check,
    TSFunctionType: check,
    TSMethodSignature: check,
  };
}
