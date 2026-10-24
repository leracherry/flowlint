import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runSuite, formatSuite, suiteFailure } from "../src/suite";
const roots: string[] = [];
const valid = JSON.stringify({ type: "RUN_ERROR", message: "ended" });
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "flowlint suite "));
  roots.push(root);
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), contents);
  }
  return root.replaceAll("\\", "/");
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("sorts and deduplicates literal and overlapping glob inputs", async () => {
  const root = await fixture({ "b.ndjson": valid, "nested/a.ndjson": valid });
  const result = await runSuite(
    [`${root}/**/*.ndjson`, `${root}/b.ndjson`, `${root}/b.ndjson`],
    { input: "auto" },
  );
  expect(result.exitCode).toBe(0);
  expect(result.summary).toEqual({
    files: 2,
    events: 2,
    errors: 0,
    warnings: 0,
  });
  expect(result.files.map((f) => f.path)).toEqual(
    [...result.files.map((f) => f.path)].sort(),
  );
  expect(
    await runSuite([`${root}/b.ndjson`, `${root}/**/*.ndjson`], {
      input: "auto",
    }),
  ).toEqual(result);
});
it("keeps parse failures isolated and gives them precedence over lint findings", async () => {
  const root = await fixture({
    "a.ndjson": "{",
    "b.ndjson": JSON.stringify({ type: "TEXT_MESSAGE_END", messageId: "m" }),
    "c.ndjson": valid,
  });
  const result = await runSuite([`${root}/*.ndjson`], { input: "auto" });
  expect(result.exitCode).toBe(2);
  expect(result.files.map((f) => f.exitCode)).toEqual([2, 1, 0]);
  expect(result.summary.files).toBe(3);
  expect(result.files[0]!.result.diagnostics[0]!.ruleId).toBe("PARSE_JSON");
});
it("reports each unmatched input even alongside matching inputs", async () => {
  const root = await fixture({ "valid.ndjson": valid });
  const result = await runSuite([`${root}/*.sse`, `${root}/valid.ndjson`], {
    input: "auto",
  });
  expect(result.exitCode).toBe(2);
  expect(result.files).toHaveLength(1);
  expect(result.problems).toMatchObject([
    { diagnostic: { ruleId: "SUITE_NO_MATCH" } },
  ]);
});
it("rejects directories, stdin, and negated patterns without hanging", async () => {
  const root = await fixture({ "valid.ndjson": valid });
  const result = await runSuite([root, "-", "!*.json"], { input: "auto" });
  expect(result.exitCode).toBe(2);
  expect(result.problems).toHaveLength(3);
  expect(result.files).toEqual([]);
});
it("treats an existing name containing brackets as a literal path", async () => {
  const root = await fixture({ "[test].ndjson": valid });
  const result = await runSuite([`${root}/[test].ndjson`], { input: "auto" });
  expect(result.exitCode).toBe(0);
  expect(result.files).toHaveLength(1);
});
it("keeps warning-only excerpts successful", async () => {
  const root = await fixture({
    "partial.ndjson": JSON.stringify({
      type: "RUN_STARTED",
      threadId: "t",
      runId: "r",
    }),
  });
  const patterns = [`${root}/*.ndjson`];
  expect((await runSuite(patterns, { input: "auto" })).exitCode).toBe(1);
  const result = await runSuite(patterns, {
    input: "auto",
    allowPartial: true,
  });
  expect(result.exitCode).toBe(0);
  expect(result.summary.warnings).toBeGreaterThan(0);
});
it("supports all existing formats without mixing file state", async () => {
  const root = await fixture({
    "a.ndjson": valid,
    "b.json": `[${valid}]`,
    "c.sse": `data: ${valid}\n\n`,
  });
  const result = await runSuite([`${root}/*`], { input: "auto" });
  expect(result.summary).toEqual({
    files: 3,
    events: 3,
    errors: 0,
    warnings: 0,
  });
  expect(JSON.parse(formatSuite(result, "json"))).toEqual(result);
});
it("escapes all annotation data and file properties", async () => {
  const root = await fixture({ "a.ndjson": valid });
  const result = await runSuite([`${root}/*`], { input: "auto" });
  result.files[0]!.path = "a,b:c%\n::error::injected";
  result.files[0]!.result.diagnostics = [
    {
      ruleId: "RULE,other=x",
      severity: "error",
      message: "bad%\r\n::error::injected",
      line: 2,
      column: 3,
    },
  ];
  const output = formatSuite(result, "github");
  expect(output.split("\n")).toHaveLength(2);
  expect(output).toContain(
    "title=RULE%2Cother=x,file=a%2Cb%3Ac%25%0A%3A%3Aerror%3A%3Ainjected,line=2,col=3",
  );
  expect(output).toContain("bad%25%0D%0A::error::injected");
});
it("renders discovery errors safely and escapes Markdown content", () => {
  const result = suiteFailure({
    ruleId: "CLI_USAGE",
    severity: "error",
    message: "<script>\n[click](https://example.com)|`x`",
  });
  expect(formatSuite(result, "github").split("\n")).toHaveLength(2);
  const markdown = formatSuite(result, "markdown");
  expect(markdown).not.toContain("<script>");
  expect(markdown).not.toContain("[click]");
  expect(markdown).toContain("&#124;");
});
