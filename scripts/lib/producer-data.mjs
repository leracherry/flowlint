import ts from "typescript";

// Interpret recorded data only. Never import or execute upstream TypeScript.
export function parseProducerSource(source, file = "trace.event-trace.ts") {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  if (ast.parseDiagnostics.length) throw new Error("Invalid TypeScript syntax");
  const values = new Map();
  function value(node) {
    if (
      ts.isAsExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return value(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return node.text;
    if (ts.isNumericLiteral(node)) {
      const number = Number(node.text);
      if (!Number.isFinite(number))
        throw new Error("Non-finite numeric literal");
      return number;
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(node) && values.has(node.text))
      return values.get(node.text);
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(value);
    if (ts.isObjectLiteralExpression(node))
      return Object.fromEntries(
        node.properties.map((p) => {
          if (
            !ts.isPropertyAssignment(p) ||
            !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
          )
            throw new Error("Unsupported property");
          return [p.name.text, value(p.initializer)];
        }),
      );
    throw new Error(
      `Unsupported data syntax in ${file}: ${node.getText(ast).slice(0, 80)}`,
    );
  }
  const journeys = {};
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    if (!ts.isVariableStatement(statement))
      throw new Error("Unexpected upstream statement");
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
        throw new Error("Unsupported declaration");
      const init = declaration.initializer;
      if (ts.isCallExpression(init)) {
        if (
          init.expression.getText(ast) !== "defineEventTrace" ||
          init.arguments.length !== 2 ||
          init.arguments[0].getText(ast) !== "import.meta.url"
        )
          throw new Error("Unexpected call");
        for (const [name, events] of Object.entries(value(init.arguments[1]))) {
          if (
            !/^[a-zA-Z0-9_-]+$/.test(name) ||
            !Array.isArray(events) ||
            Object.hasOwn(journeys, name)
          )
            throw new Error("Invalid or duplicate journey");
          Object.defineProperty(journeys, name, {
            value: events,
            enumerable: true,
          });
        }
      } else values.set(declaration.name.text, value(init));
    }
  }
  if (!Object.keys(journeys).length)
    throw new Error("No recorded journeys found");
  return journeys;
}
