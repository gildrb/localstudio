import type { ESTree } from "@oxlint/plugins";

const BUILT_INS = new Set([
  "Record",
  "Readonly",
  "Partial",
  "Required",
  "Pick",
  "Omit",
  "PropertyKey",
  "NonNullable",
]);
const WRAPPERS = new Set(["Readonly", "Partial", "Required", "NonNullable"]);
type Substitutions = ReadonlyMap<string, ESTree.TSType>;
type UnsafeValue = "any" | "empty-object" | "object" | "union" | "unknown";
export type UnsafeDictionary = {
  readonly kind: "unsafe-dictionary";
  readonly unsafeValue: UnsafeValue;
};
export type WideningTarget = {
  readonly kind:
    | "anonymous object"
    | "generic container"
    | "object"
    | "open dictionary"
    | "unknown";
};
export type TypeEnvironment = {
  readonly aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>;
  readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
  readonly shadowedBuiltIns: ReadonlySet<string>;
};
type Resolution = {
  readonly substitutions: Substitutions;
  readonly resolving: ReadonlySet<string>;
};

function declarationOf(statement: ESTree.Statement): ESTree.Node | null {
  return statement.type === "ExportNamedDeclaration" ||
    statement.type === "ExportDefaultDeclaration"
    ? (statement.declaration ?? null)
    : statement;
}

export function createTypeEnvironment(program: ESTree.Program): TypeEnvironment {
  const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
  const interfaces = new Map<string, ESTree.TSInterfaceDeclaration[]>();
  const shadowedBuiltIns = new Set<string>();
  for (const statement of program.body) {
    const declaration = declarationOf(statement);
    if (declaration?.type === "ImportDeclaration") {
      for (const specifier of declaration.specifiers) {
        if (BUILT_INS.has(specifier.local.name)) shadowedBuiltIns.add(specifier.local.name);
      }
    } else if (declaration?.type === "TSTypeAliasDeclaration") {
      if (aliases.has(declaration.id.name)) shadowedBuiltIns.add(declaration.id.name);
      else aliases.set(declaration.id.name, declaration);
      if (BUILT_INS.has(declaration.id.name)) shadowedBuiltIns.add(declaration.id.name);
    } else if (declaration?.type === "TSInterfaceDeclaration") {
      const declarations = interfaces.get(declaration.id.name) ?? [];
      declarations.push(declaration);
      interfaces.set(declaration.id.name, declarations);
      if (BUILT_INS.has(declaration.id.name)) shadowedBuiltIns.add(declaration.id.name);
    } else if (declaration?.type === "TSEnumDeclaration") {
      if (BUILT_INS.has(declaration.id.name)) shadowedBuiltIns.add(declaration.id.name);
    } else if (
      (declaration?.type === "ClassDeclaration" || declaration?.type === "FunctionDeclaration") &&
      declaration.id !== null &&
      BUILT_INS.has(declaration.id.name)
    ) {
      shadowedBuiltIns.add(declaration.id.name);
    }
  }
  return { aliases, interfaces, shadowedBuiltIns };
}

function unwrap(type: ESTree.TSType): ESTree.TSType {
  let current = type;
  while (
    current.type === "TSParenthesizedType" ||
    (current.type === "TSTypeOperator" && current.operator === "readonly")
  ) {
    current = current.typeAnnotation;
  }
  return current;
}
function referenceName(type: ESTree.TSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}
function builtIn(name: string, environment: TypeEnvironment): boolean {
  return BUILT_INS.has(name) && !environment.shadowedBuiltIns.has(name);
}
function unapplied(type: ESTree.TSType, name: string): boolean {
  const value = unwrap(type);
  return (
    value.type === "TSTypeReference" &&
    referenceName(value) === name &&
    !value.typeArguments?.params.length
  );
}
function substitute(
  type: ESTree.TSType,
  substitutions: Substitutions,
  seen = new Set<string>(),
): ESTree.TSType {
  const value = unwrap(type);
  if (value.type !== "TSTypeReference") return type;
  const name = referenceName(value);
  if (name === null || seen.has(name)) return type;
  const next = substitutions.get(name);
  if (next === undefined) return type;
  seen.add(name);
  return substitute(next, substitutions, seen);
}
function enterAlias(
  alias: ESTree.TSTypeAliasDeclaration,
  reference: ESTree.TSTypeReference,
  state: Resolution,
): Resolution | null {
  const next = new Map(state.substitutions);
  const arguments_ = reference.typeArguments?.params ?? [];
  for (const [index, parameter] of (alias.typeParameters?.params ?? []).entries()) {
    const argument = arguments_[index] ?? parameter.default;
    if (argument == null) return null;
    next.set(parameter.name.name, substitute(argument, next));
  }
  return { substitutions: next, resolving: new Set([...state.resolving, alias.id.name]) };
}
function emptyMember(member: ESTree.TSSignature): boolean {
  return (
    member.type === "TSPropertySignature" &&
    member.optional === true &&
    member.typeAnnotation != null &&
    unwrap(member.typeAnnotation.typeAnnotation).type === "TSNeverKeyword"
  );
}
function emptyInterface(declarations: readonly ESTree.TSInterfaceDeclaration[]): boolean {
  const [declaration] = declarations;
  return (
    declarations.length === 1 &&
    declaration !== undefined &&
    declaration.extends.length === 0 &&
    declaration.body.body.every(emptyMember)
  );
}

function unsafeValue(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  state: Resolution,
): UnsafeValue | null {
  const value = unwrap(type);
  if (value.type === "TSUnknownKeyword") return "unknown";
  if (value.type === "TSAnyKeyword") return "any";
  if (value.type === "TSObjectKeyword") return "object";
  if (value.type === "TSTypeLiteral" && value.members.every(emptyMember)) return "empty-object";
  if (value.type === "TSUnionType") {
    return value.types.some((member) => unsafeValue(member, environment, state) !== null)
      ? "union"
      : null;
  }
  if (value.type === "TSIntersectionType") {
    const members = value.types.map((member) => unsafeValue(member, environment, state));
    if (members.includes("any")) return "any";
    return members.length > 0 && members.every((member) => member !== null) ? members[0] : null;
  }
  if (value.type !== "TSTypeReference") return null;
  const name = referenceName(value);
  if (name === null) return null;
  if (WRAPPERS.has(name) && builtIn(name, environment)) {
    const wrapped = value.typeArguments?.params[0];
    return wrapped === undefined ? null : unsafeValue(wrapped, environment, state);
  }
  const replacement = state.substitutions.get(name);
  if (replacement !== undefined)
    return unapplied(replacement, name) ? null : unsafeValue(replacement, environment, state);
  const declarations = environment.interfaces.get(name);
  if (declarations !== undefined) return emptyInterface(declarations) ? "empty-object" : null;
  const alias = environment.aliases.get(name);
  if (alias === undefined || state.resolving.has(name)) return null;
  const next = enterAlias(alias, value, state);
  return next === null ? null : unsafeValue(alias.typeAnnotation, environment, next);
}

type DictionaryVisitor<Result> = (type: ESTree.TSType, state: Resolution) => Result | null;
function visitDictionary<Result>(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  state: Resolution,
  visit: DictionaryVisitor<Result>,
): Result | null {
  const value = unwrap(type);
  if (value.type === "TSTypeLiteral") {
    for (const member of value.members) {
      if (member.type === "TSIndexSignature" && member.typeAnnotation !== null) {
        const result = visit(member.typeAnnotation.typeAnnotation, state);
        if (result !== null) return result;
      }
    }
    return null;
  }
  if (value.type === "TSMappedType")
    return value.typeAnnotation === null ? null : visit(value.typeAnnotation, state);
  if (value.type !== "TSTypeReference") return null;
  const name = referenceName(value);
  if (name === null) return null;
  const replacement = state.substitutions.get(name);
  if (replacement !== undefined)
    return unapplied(replacement, name)
      ? null
      : visitDictionary(replacement, environment, state, visit);
  if (WRAPPERS.has(name) && builtIn(name, environment)) {
    const wrapped = value.typeArguments?.params[0];
    return wrapped === undefined ? null : visitDictionary(wrapped, environment, state, visit);
  }
  if (name === "Record" && builtIn(name, environment)) {
    const dictionaryValue = value.typeArguments?.params[1];
    return dictionaryValue === undefined ? null : visit(dictionaryValue, state);
  }
  if ((name === "Pick" || name === "Omit") && builtIn(name, environment)) {
    const source = value.typeArguments?.params[0];
    return source === undefined ? null : visitDictionary(source, environment, state, visit);
  }
  const alias = environment.aliases.get(name);
  if (alias === undefined || state.resolving.has(name)) return null;
  const next = enterAlias(alias, value, state);
  return next === null ? null : visitDictionary(alias.typeAnnotation, environment, next, visit);
}
const initialResolution: Resolution = { substitutions: new Map(), resolving: new Set() };

export function classifyUnsafeDictionaryValue(
  type: ESTree.TSType,
  environment: TypeEnvironment,
): UnsafeDictionary | null {
  const result = unsafeValue(type, environment, initialResolution);
  return result === null ? null : { kind: "unsafe-dictionary", unsafeValue: result };
}
export function classifyUnsafeDictionary(
  type: ESTree.TSType,
  environment: TypeEnvironment,
): UnsafeDictionary | null {
  const result = visitDictionary(type, environment, initialResolution, (value, state) =>
    unsafeValue(value, environment, state),
  );
  return result === null ? null : { kind: "unsafe-dictionary", unsafeValue: result };
}

function broadKey(type: ESTree.TSType, environment: TypeEnvironment, state: Resolution): boolean {
  const value = unwrap(type);
  if (
    value.type === "TSStringKeyword" ||
    value.type === "TSNumberKeyword" ||
    value.type === "TSSymbolKeyword"
  )
    return true;
  if (value.type === "TSUnionType")
    return value.types.every((member) => broadKey(member, environment, state));
  if (value.type !== "TSTypeReference") return false;
  const name = referenceName(value);
  if (name === null) return false;
  const replacement = state.substitutions.get(name);
  return replacement !== undefined && !unapplied(replacement, name)
    ? broadKey(replacement, environment, state)
    : name === "PropertyKey" && builtIn(name, environment);
}
function wideningTarget(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  state: Resolution,
  direct: boolean,
): WideningTarget | null {
  const value = unwrap(type);
  if (value.type === "TSUnknownKeyword") return { kind: "unknown" };
  if (value.type === "TSObjectKeyword") return { kind: "object" };
  if (value.type === "TSTypeLiteral") {
    if (value.members.some((member) => member.type === "TSIndexSignature"))
      return { kind: "open dictionary" };
    return direct && value.members.length > 0 ? { kind: "anonymous object" } : null;
  }
  if (value.type === "TSMappedType") {
    return direct || broadKey(value.constraint, environment, state)
      ? { kind: "open dictionary" }
      : null;
  }
  if (value.type !== "TSTypeReference") return null;
  const name = referenceName(value);
  if (name === null) return null;
  const replacement = state.substitutions.get(name);
  if (replacement !== undefined)
    return unapplied(replacement, name)
      ? null
      : wideningTarget(replacement, environment, state, false);
  if (WRAPPERS.has(name) && builtIn(name, environment)) {
    const wrapped = value.typeArguments?.params[0];
    return wrapped === undefined ? null : wideningTarget(wrapped, environment, state, direct);
  }
  if (name === "Record" && builtIn(name, environment)) return { kind: "open dictionary" };
  const alias = environment.aliases.get(name);
  if (alias === undefined || state.resolving.has(name)) return null;
  const next = enterAlias(alias, value, state);
  if (next === null) return null;
  if (direct && (alias.typeParameters?.params.length ?? 0) > 0) {
    return visitDictionary(alias.typeAnnotation, environment, next, () => true) === true
      ? { kind: "generic container" }
      : null;
  }
  return wideningTarget(alias.typeAnnotation, environment, next, false);
}
export function classifyWideningTarget(
  type: ESTree.TSType,
  environment: TypeEnvironment,
): WideningTarget | null {
  return wideningTarget(type, environment, initialResolution, true);
}

export function isKnownEvidenceExpression(expression: ESTree.Expression): boolean {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSSatisfiesExpression"
  )
    current = current.expression;
  return (
    current.type === "ObjectExpression" ||
    current.type === "ArrayExpression" ||
    current.type === "ArrowFunctionExpression" ||
    current.type === "ClassExpression" ||
    current.type === "FunctionExpression" ||
    current.type === "NewExpression" ||
    current.type === "Literal" ||
    current.type === "TemplateLiteral" ||
    current.type === "UnaryExpression"
  );
}
