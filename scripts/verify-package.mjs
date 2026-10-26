import spawn from "cross-spawn";
const spawnSync = spawn.sync;
function execFileSync(command, args, options = {}) {
  const result = spawnSync(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr?.toString() ?? ""}`);
  return result.stdout;
}
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const root = process.cwd();
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const destination = resolve("release");
mkdirSync(destination, { recursive: true });
const [packed] = JSON.parse(
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", destination],
    { encoding: "utf8" },
  ),
);
const paths = packed.files.map((file) => file.path);
for (const path of paths)
  assert.match(
    path,
    /^(dist\/[^/]+\.(?:js|js\.map|d\.ts)|examples\/[^/]+\.(?:ndjson|sse|mjs)|package\.json|README\.md|REFERENCE\.md|COMPATIBILITY\.md|LICENSE|CHANGELOG\.md|RELEASING\.md)$/,
  );
for (const path of [
  "dist/cli.js",
  "dist/index.js",
  "dist/index.d.ts",
  "README.md",
  "REFERENCE.md",
  "COMPATIBILITY.md",
  "LICENSE",
  "CHANGELOG.md",
])
  assert(paths.includes(path), `Missing ${path}`);
const tarball = join(destination, packed.filename);
const consumer = mkdtempSync(join(tmpdir(), "flowlint package "));
try {
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "flowlint-consumer-check",
      private: true,
      type: "module",
    }),
  );
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    { cwd: consumer, stdio: "pipe" },
  );
  const run = (args) =>
    spawnSync("npm", ["exec", "--no", "--", "flowlint", ...args], {
      cwd: consumer,
      encoding: "utf8",
    });
  const version = run(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), pkg.version);
  for (const name of [
    "valid.ndjson",
    "interleaved.ndjson",
    "chunks.ndjson",
    "reasoning.ndjson",
    "state.ndjson",
    "activity.ndjson",
    "preservation.ndjson",
    "stream.sse",
  ]) {
    const result = run([
      "check",
      join(root, "examples", name),
      "--format",
      "json",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).valid, true);
  }
  const invalid = run([
    "check",
    join(root, "examples/invalid.ndjson"),
    "--format",
    "json",
  ]);
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stdout).diagnostics[0].ruleId, "FL002");
  const suite = run([
    "suite",
    join(root, "examples", "{valid,interleaved,chunks}.ndjson").replaceAll(
      "\\",
      "/",
    ),
    "--format",
    "json",
  ]);
  assert.equal(suite.status, 0, suite.stderr || suite.stdout);
  assert.equal(JSON.parse(suite.stdout).schemaVersion, 1);
  assert.equal(JSON.parse(suite.stdout).summary.files, 3);
  const comparison = run([
    "compare",
    join(root, "examples/valid.ndjson"),
    join(root, "examples/valid.ndjson"),
    "--format",
    "json",
  ]);
  assert.equal(comparison.status, 0, comparison.stderr || comparison.stdout);
  assert.equal(JSON.parse(comparison.stdout).status, "equal");
  const reportPath = join(consumer, "trace report.html");
  const report = run([
    "report",
    join(root, "examples/valid.ndjson"),
    "--output",
    reportPath,
  ]);
  assert.equal(report.status, 0, report.stderr || report.stdout);
  assert(readFileSync(reportPath, "utf8").startsWith("<!doctype html>"));
  const listed = run([
    "minimize",
    join(root, "examples/invalid.ndjson"),
    "--list",
  ]);
  assert.equal(listed.status, 0, listed.stderr || listed.stdout);
  const findingId = listed.stdout.match(/repro-v1:[a-f0-9]+/)?.[0];
  assert(findingId);
  const reproDirectory = join(consumer, "reproducer bundle");
  const minimized = run([
    "minimize",
    join(root, "examples/invalid.ndjson"),
    "--finding",
    findingId,
    "--output",
    reproDirectory,
  ]);
  assert.equal(minimized.status, 0, minimized.stderr || minimized.stdout);
  assert.equal(
    JSON.parse(readFileSync(join(reproDirectory, "manifest.json"), "utf8"))
      .finding.id,
    findingId,
  );
  writeFileSync(
    join(consumer, "consumer.mts"),
    `import { compareTraces, formatComparison, lintEvents, parseTrace, formatJson, formatPretty, RULES, SUPPORTED_RULES, createHttpCapture, createLintSession, parseTraceStream, lintTraceStream, generateHtmlReport, getReproFindings, minimizeTrace, type DiagnosticLocation, type LintResult } from '${pkg.name}';\nconst compared = compareTraces(parseTrace('[{\"type\":\"RUN_ERROR\",\"message\":\"example\"}]'), parseTrace('[{\"type\":\"RUN_ERROR\",\"message\":\"example\"}]')); if (compared.status !== 'equal' || !formatComparison(compared)) throw new Error('Invalid comparison export');\nconst result: LintResult = lintEvents(parseTrace('[{"type":"RUN_ERROR","message":"example"}]'));\nif (!result.valid || !formatJson(result) || !formatPretty(result, '-')) throw new Error('Invalid library result');\nconst first: 'FL001' = SUPPORTED_RULES[0];\nconst location: DiagnosticLocation = { eventIndex: 0, line: 1, column: 1 };\nif (RULES[0].id !== first || location.eventIndex !== 0) throw new Error('Invalid metadata');\nconst capture = createHttpCapture({ directory: '.', producer: { name: 'verification', version: '1' }, fetch: async () => new Response('not SSE') });\nawait capture.fetch('https://example.com');\nif ((await capture.flush())[0]?.outcome !== 'skipped') throw new Error('Invalid capture export');\nconst session = createLintSession();\nasync function* chunks() { yield new TextEncoder().encode(JSON.stringify({ type: 'RUN_ERROR', message: 'example' }) + String.fromCharCode(10)); }\nfor await (const record of parseTraceStream(chunks())) session.push(record);\nif (!session.finish().valid || !(await lintTraceStream(chunks())).valid) throw new Error('Invalid session export');\nif (!generateHtmlReport(parseTrace('[{\"type\":\"RUN_ERROR\",\"message\":\"example\"}]')).startsWith('<!doctype html>')) throw new Error('Invalid HTML export');\nconst reproRecords = parseTrace(JSON.stringify([{ type: 'RUN_STARTED', threadId: 't', runId: 'r' }, { type: 'TEXT_MESSAGE_END', messageId: 'm' }, { type: 'RUN_FINISHED', threadId: 't', runId: 'r' }]));\nconst candidate = getReproFindings(reproRecords).find(f => f.supported)!;\nconst repro = await minimizeTrace(reproRecords, { findingId: candidate.id });\nif (!repro.validation.diagnostics.some(d => d.ruleId === 'FL002')) throw new Error('Invalid reproducer export');\n`,
  );
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "consumer.mts",
    ],
    { cwd: consumer, stdio: "pipe" },
  );
  execFileSync(process.execPath, ["consumer.mjs"], {
    cwd: consumer,
    stdio: "pipe",
  });
  console.log(
    `Verified ${packed.filename}: ${paths.length} allowed files, CLI exit codes, library imports, and TypeScript declarations.`,
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
