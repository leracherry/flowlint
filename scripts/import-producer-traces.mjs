import ts from "typescript";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
// Parse a deliberately small data-only subset. Never execute upstream TypeScript.
const sourceDir = process.argv[2];
const outputDir = process.argv[3];
if (!sourceDir || !outputDir)
  throw new Error(
    "Usage: node scripts/import-producer-traces.mjs SOURCE_DIR OUTPUT_DIR",
  );
const revision = "89cedd3fd549feeee41e50e1d7c6d373e549241a";
mkdirSync(outputDir, { recursive: true });
const manifest = [];
for (const file of readdirSync(sourceDir)
  .filter((f) => f.endsWith(".event-trace.ts"))
  .sort()) {
  const source = readFileSync(join(sourceDir, file), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
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
    if (ts.isNumericLiteral(node)) return Number(node.text);
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
        const journeys = value(init.arguments[1]);
        for (const [journey, events] of Object.entries(journeys)) {
          if (!/^[a-zA-Z0-9_-]+$/.test(journey) || !Array.isArray(events))
            throw new Error("Invalid journey");
          const fixture = `${file.replace(".event-trace.ts", "")}-${journey}.ndjson`;
          const content =
            events.map((e) => JSON.stringify(e)).join("\n") + "\n";
          writeFileSync(join(outputDir, fixture), content);
          const split = file.indexOf("-");
          const path = `apps/dojo/e2e/tests/${file.slice(0, split)}/${file.slice(split + 1)}`;
          manifest.push({
            file: fixture,
            producer: file.slice(0, split),
            journey,
            source: `https://github.com/ag-ui-protocol/ag-ui/blob/${revision}/${path}`,
            sourceSha256: createHash("sha256").update(source).digest("hex"),
            sha256: createHash("sha256").update(content).digest("hex"),
            events: events.length,
          });
        }
      } else values.set(declaration.name.text, value(init));
    }
  }
}
copyFileSync(join(sourceDir, "LICENSE"), join(outputDir, "LICENSE.upstream"));
writeFileSync(
  join(outputDir, "manifest.json"),
  JSON.stringify({ revision, traces: manifest }, null, 2) + "\n",
);
console.log(`Imported ${manifest.length} recorded journeys`);
