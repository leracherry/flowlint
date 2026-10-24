import { execFileSync, spawnSync } from "node:child_process";
import { beforeAll, expect, it, vi } from "vitest";
vi.setConfig({ testTimeout: 20000 });
beforeAll(() => {
  execFileSync(process.execPath, ["node_modules/tsup/dist/cli-default.js"], {
    stdio: "pipe",
  });
}, 60000);
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8" });
it("prints help and version", () => {
  expect(cli("--help").status).toBe(0);
  expect(cli("--version").stdout.trim()).toBe("1.0.0");
});
it("returns 0 for valid input and 1 for lint errors", () => {
  expect(cli("check", "examples/valid.ndjson").status).toBe(0);
  const bad = cli("check", "examples/invalid.ndjson", "--format", "json");
  expect(bad.status).toBe(1);
  expect(JSON.parse(bad.stdout).diagnostics[0].ruleId).toBe("FL002");
});
it("returns 2 for input and usage failures", () => {
  expect(cli("check", "missing.ndjson").status).toBe(2);
  expect(cli("check", "examples/valid.ndjson", "--input", "yaml").status).toBe(
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
it.each([
  ["check", "--format", "json"],
  ["check", "examples/valid.ndjson", "--bogus", "--format=json"],
  [
    "check",
    "examples/valid.ndjson",
    "examples/invalid.ndjson",
    "--format",
    "json",
  ],
  ["check", "examples/valid.ndjson", "--input", "yaml", "--format", "json"],
])("returns machine-readable usage errors for %j", (...args) => {
  const result = cli(...args);
  expect(result.status).toBe(2);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).diagnostics[0].ruleId).toBe("CLI_USAGE");
});
it("emits deterministic JSON with a newline and no progress output", () => {
  const args = [
    "check",
    "test/fixtures/invalid/FL003.json",
    "--format",
    "json",
  ];
  const result = cli(...args);
  expect(result.stdout).toBe(cli(...args).stdout);
  expect(result.stdout.endsWith("\n")).toBe(true);
  expect(result.stderr).toBe("");
});
it("does not expand glob patterns or accept directories as traces", () => {
  expect(cli("check", "examples/*.ndjson").status).toBe(2);
  expect(cli("check", "examples").status).toBe(2);
});
it("keeps redirected output uncolored even if FORCE_COLOR is set", () => {
  const result = spawnSync(
    process.execPath,
    ["dist/cli.js", "check", "examples/invalid.ndjson"],
    { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "1" } },
  );
  expect(result.stdout).not.toContain("\u001b");
});
it("NO_COLOR suppresses styling on a terminal", () => {
  const wrapper =
    'process.argv = [process.execPath, "dist/cli.js", ...process.argv.slice(1)]; Object.defineProperty(process.stdout, "isTTY", { value: true }); await import("./dist/cli.js")';
  const run = (noColor: boolean) => {
    const env = { ...process.env };
    delete env.NO_COLOR;
    if (noColor) env.NO_COLOR = "";
    return spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        wrapper,
        "--",
        "check",
        "examples/invalid.ndjson",
      ],
      { encoding: "utf8", env },
    );
  };
  const plain = run(true);
  const colored = run(false);
  expect(plain.status).toBe(1);
  expect(colored.status).toBe(1);
  expect(plain.stdout).not.toContain("\u001b");
  expect(colored.stdout).toContain("\u001b[31m");
});
it.each(["ndjson", "json"])("accepts valid %s from stdin", (format) => {
  const events = [
    { type: "RUN_STARTED", threadId: "thread", runId: "run" },
    { type: "RUN_FINISHED", threadId: "thread", runId: "run" },
  ];
  const input =
    format === "json"
      ? JSON.stringify(events)
      : events.map((e) => JSON.stringify(e)).join("\n");
  const result = spawnSync(
    process.execPath,
    ["dist/cli.js", "check", "-", "--input", format, "--format", "json"],
    { input, encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: true,
    checkedEvents: 2,
  });
});
it("reports subagent lifecycle failures through the packaged CLI", () => {
  const input: unknown[] = [
    { type: "RUN_STARTED", threadId: "t", runId: "r" },
    { type: "SUBAGENT_STARTED", subagentRunId: "a", name: "worker" },
    { type: "RUN_FINISHED", threadId: "t", runId: "r" },
  ];
  const run = (events: unknown[]) =>
    spawnSync(
      process.execPath,
      ["dist/cli.js", "check", "-", "--format", "json"],
      { input: JSON.stringify(events), encoding: "utf8" },
    );
  const invalid = run(input);
  expect(invalid.status).toBe(1);
  expect(JSON.parse(invalid.stdout).diagnostics).toMatchObject([
    { ruleId: "SUBAGENT_OPEN", severity: "error", eventIndex: 2 },
  ]);
  input.splice(2, 0, { type: "SUBAGENT_FINISHED", subagentRunId: "a" });
  expect(run(input).status).toBe(0);
});
it("checks reasoning and step lifecycles through the CLI", () => {
  expect(cli("check", "examples/reasoning.ndjson").status).toBe(0);
  const result = spawnSync(
    process.execPath,
    ["dist/cli.js", "check", "-", "--format", "json"],
    {
      input: JSON.stringify([
        { type: "RUN_STARTED", threadId: "t", runId: "r" },
        { type: "REASONING_START", messageId: "span" },
        {
          type: "REASONING_MESSAGE_CONTENT",
          messageId: "m",
          delta: "PRIVATE_REASONING",
        },
        { type: "STEP_FINISHED", stepName: "missing" },
        { type: "RUN_FINISHED", threadId: "t", runId: "r" },
      ]),
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(1);
  expect(
    JSON.parse(result.stdout).diagnostics.map(
      (d: { ruleId: string }) => d.ruleId,
    ),
  ).toEqual(["REASONING_MESSAGE_MISSING", "STEP_END", "REASONING_SPAN_OPEN"]);
  expect(result.stdout).not.toContain("PRIVATE_REASONING");
});
it("reads SSE files automatically and SSE stdin explicitly", () => {
  expect(cli("check", "examples/stream.sse").status).toBe(0);
  const result = spawnSync(
    process.execPath,
    ["dist/cli.js", "check", "-", "--input", "sse", "--format", "json"],
    {
      input: 'data: {"type":"RUN_ERROR","message":"example"}\n\n',
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).checkedEvents).toBe(1);
});
it("reports malformed SSE as an input error even in partial mode", () => {
  const result = spawnSync(
    process.execPath,
    [
      "dist/cli.js",
      "check",
      "-",
      "--input",
      "sse",
      "--allow-partial",
      "--format",
      "json",
    ],
    {
      input: 'data: {"type":"RUN_ERROR","message":"example"}\n',
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(2);
  expect(JSON.parse(result.stdout).diagnostics[0].ruleId).toBe(
    "PARSE_SSE_TRUNCATED",
  );
});
it("keeps unappliable state patches nonfatal in the CLI", () => {
  const result = spawnSync(
    process.execPath,
    ["dist/cli.js", "check", "-", "--format", "json"],
    {
      input: JSON.stringify([
        { type: "RUN_STARTED", threadId: "t", runId: "r" },
        { type: "STATE_SNAPSHOT", snapshot: {} },
        { type: "STATE_DELTA", delta: [{ op: "remove", path: "/PRIVATE" }] },
        { type: "RUN_FINISHED", threadId: "t", runId: "r" },
      ]),
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).diagnostics[0]).toMatchObject({
    ruleId: "STATE_PATCH",
    severity: "warning",
  });
  expect(result.stdout).not.toContain("PRIVATE");
});

it("checks a suite with versioned JSON and lint failure exit status", () => {
  const result = cli(
    "suite",
    "examples/valid.ndjson",
    "examples/invalid.ndjson",
    "--format",
    "json",
  );
  expect(result.status).toBe(1);
  const suite = JSON.parse(result.stdout);
  expect(suite.schemaVersion).toBe(1);
  expect(suite.summary.files).toBe(2);
  expect(suite.files.map((f: { path: string }) => f.path)).toEqual([
    "examples/invalid.ndjson",
    "examples/valid.ndjson",
  ]);
});
it("reports suite usage errors in the aggregate JSON envelope", () => {
  for (const args of [
    ["suite", "--format", "json"],
    ["suite", "examples/valid.ndjson", "--bad", "--format=json"],
  ]) {
    const result = cli(...args);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 1,
      valid: false,
      exitCode: 2,
      problems: [{ diagnostic: { ruleId: "CLI_USAGE" } }],
    });
  }
});
it("reports no glob matches and produces GitHub annotations", () => {
  expect(cli("suite", "missing-directory/**/*.ndjson").status).toBe(2);
  const result = cli("suite", "examples/invalid.ndjson", "--format", "github");
  expect(result.status).toBe(1);
  expect(result.stdout).toContain(
    "::error title=FL002,file=examples/invalid.ndjson",
  );
});
