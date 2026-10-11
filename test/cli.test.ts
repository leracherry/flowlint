import { execFileSync, spawnSync } from "node:child_process";
import { beforeAll, expect, it } from "vitest";
beforeAll(() => {
  execFileSync("pnpm", ["build"], { stdio: "pipe" });
}, 30000);
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8" });
it("prints help and version", () => {
  expect(cli("--help").status).toBe(0);
  expect(cli("--version").stdout.trim()).toBe("0.1.0");
});
it("returns 0 for valid input and 1 for lint errors", () => {
  expect(cli("check", "examples/valid.ndjson").status).toBe(0);
  const bad = cli("check", "examples/invalid.ndjson", "--format", "json");
  expect(bad.status).toBe(1);
  expect(JSON.parse(bad.stdout).diagnostics[0].ruleId).toBe("FL002");
});
it("returns 2 for input and usage failures", () => {
  expect(cli("check", "missing.ndjson").status).toBe(2);
  expect(cli("check", "examples/valid.ndjson", "--input", "sse").status).toBe(
    2,
  );
  expect(cli("check", "examples/valid.ndjson", "--format", "xml").status).toBe(
    2,
  );
  expect(cli("check").status).toBe(2);
});
it("reads stdin and keeps sensitive syntax errors private", () => {
  const result = spawnSync(
    process.execPath,
    ["dist/cli.js", "check", "-", "--format", "json"],
    { input: '{"secret":"PRIVATE_BODY",}', encoding: "utf8" },
  );
  expect(result.status).toBe(2);
  expect(result.stdout).not.toContain("PRIVATE_BODY");
  expect(JSON.parse(result.stdout).diagnostics[0].ruleId).toBe("PARSE_JSON");
});
it("uses the same supported rule list in pretty and JSON output", () => {
  const json = JSON.parse(
    cli("check", "examples/valid.ndjson", "--format", "json").stdout,
  );
  const pretty = cli("check", "examples/valid.ndjson").stdout;
  expect(json.supportedRules).toContain("FL009");
  expect(pretty).toContain(`supported rules: ${json.supportedRules.length}`);
});
it("supports partial excerpts without hiding observed duplicate starts", () => {
  expect(cli("check", "examples/partial.ndjson").status).toBe(1);
  expect(
    cli("check", "examples/partial.ndjson", "--allow-partial").status,
  ).toBe(0);
  expect(
    cli("check", "test/fixtures/invalid/FL008.json", "--allow-partial").status,
  ).toBe(1);
});
it("reports EOF errors in complete captures and warnings in partial captures", () => {
  expect(cli("check", "test/fixtures/invalid/FL012.json").status).toBe(1);
  const partial = cli(
    "check",
    "test/fixtures/invalid/FL012.json",
    "--allow-partial",
    "--format",
    "json",
  );
  expect(partial.status).toBe(0);
  expect(JSON.parse(partial.stdout).diagnostics[0]).toMatchObject({
    ruleId: "FL012",
    severity: "warning",
  });
});
it("accepts the interleaved example", () =>
  expect(cli("check", "examples/interleaved.ndjson").status).toBe(0));
it("accepts shorthand fixtures through the bundled CLI", () => {
  expect(cli("check", "examples/chunks.ndjson").status).toBe(0);
  const result = cli(
    "check",
    "test/fixtures/invalid/FL011.json",
    "--format",
    "json",
  );
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout).diagnostics[0].ruleId).toBe("FL011");
});
