import { execFileSync, spawnSync } from "node:child_process";
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
    /^(dist\/[^/]+\.(?:js|js\.map|d\.ts)|examples\/[^/]+\.ndjson|package\.json|README\.md|REFERENCE\.md|LICENSE|CHANGELOG\.md|RELEASING\.md)$/,
  );
for (const path of [
  "dist/cli.js",
  "dist/index.js",
  "dist/index.d.ts",
  "README.md",
  "REFERENCE.md",
  "LICENSE",
  "CHANGELOG.md",
])
  assert(paths.includes(path), `Missing ${path}`);
const tarball = join(destination, packed.filename);
const consumer = mkdtempSync(join(tmpdir(), "flowlint-package-"));
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
  for (const name of ["valid", "interleaved", "chunks"]) {
    const result = run([
      "check",
      join(root, "examples", `${name}.ndjson`),
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
  writeFileSync(
    join(consumer, "consumer.mts"),
    `import { lintEvents, parseTrace, formatJson, formatPretty, type LintResult } from '${pkg.name}';\nconst result: LintResult = lintEvents(parseTrace('[{"type":"RUN_ERROR","message":"example"}]'));\nif (!result.valid || !formatJson(result) || !formatPretty(result, '-')) throw new Error('Invalid library result');\n`,
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
