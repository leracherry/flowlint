import { describe, expect, it } from "vitest";
import { lintEvents, parseTrace } from "../src/index";
const start = { type: "RUN_STARTED", threadId: "t", runId: "r" };
const finish = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
const snap = (snapshot: unknown) => ({ type: "STATE_SNAPSHOT", snapshot });
const delta = (...operations: unknown[]) => ({
  type: "STATE_DELTA",
  delta: operations,
});
const test = (path: string, value: unknown) => ({ op: "test", path, value });
const lint = (events: unknown[]) =>
  lintEvents(parseTrace(JSON.stringify(events)));
const codes = (events: unknown[]) =>
  lint(events).diagnostics.map((d) => d.ruleId);
const run = (snapshot: unknown, ...events: unknown[]) =>
  lint([start, snap(snapshot), ...events, finish]);
describe("state patches", () => {
  it("applies all six operations sequentially", () =>
    expect(
      run(
        { items: [1, 2], old: true },
        delta(
          { op: "add", path: "/items/-", value: 3 },
          { op: "replace", path: "/items/0", value: 4 },
          { op: "copy", from: "/items", path: "/copy" },
          { op: "move", from: "/items/0", path: "/items/2" },
          { op: "remove", path: "/old" },
          test("", { items: [2, 3, 4], copy: [4, 2, 3] }),
        ),
      ).diagnostics,
    ).toEqual([]));
  it("retains prior state atomically after a failed operation", () => {
    const result = run(
      { n: 1 },
      delta(
        { op: "replace", path: "/n", value: 2 },
        { op: "remove", path: "/missing" },
      ),
      delta(test("/n", 1)),
    );
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toMatchObject([
      { ruleId: "STATE_PATCH", severity: "warning", eventIndex: 2 },
    ]);
    expect(result.diagnostics[0]?.message).toContain("operation 2");
  });
  it("rolls back failed tests and resynchronizes by replacing snapshots", () =>
    expect(
      run(
        { n: 1 },
        delta({ op: "add", path: "/other", value: true }, test("/n", 2)),
        snap({ n: 3 }),
        delta(test("", { n: 3 })),
      ).diagnostics.map((d) => d.ruleId),
    ).toEqual(["STATE_PATCH"]));
  it.each([null, false, 0, "", [], {}])(
    "supports JSON root value %j",
    (value) =>
      expect(
        run(
          value,
          delta(
            test("", value),
            { op: "replace", path: "", value: { yes: true } },
            test("/yes", true),
          ),
        ).diagnostics,
      ).toEqual([]),
  );
  it("supports removing and restoring the root", () =>
    expect(
      run(
        { n: 1 },
        delta(
          { op: "remove", path: "" },
          { op: "add", path: "", value: null },
          test("", null),
        ),
      ).diagnostics,
    ).toEqual([]));
  it("decodes escaped and empty object keys", () =>
    expect(
      run(
        { "a/b": { "~": { "": 1 } } },
        delta(
          { op: "replace", path: "/a~1b/~0/", value: 2 },
          test("/a~1b/~0/", 2),
        ),
      ).diagnostics,
    ).toEqual([]));
  it.each(["/01", "/-1", "/2", "/-", "/999999999999999999999"])(
    "rejects invalid array target %s",
    (path) =>
      expect(
        run([1], delta({ op: "replace", path, value: 2 })).diagnostics[0]
          ?.ruleId,
      ).toBe("STATE_PATCH"),
  );
  it("permits array insertion at length but not beyond it", () =>
    expect(
      run(
        [1],
        delta({ op: "add", path: "/1", value: 2 }, test("", [1, 2])),
        delta({ op: "add", path: "/3", value: 4 }),
      ).diagnostics.map((d) => d.ruleId),
    ).toEqual(["STATE_PATCH"]));
  it("requires existing parents and replace/remove targets", () =>
    expect(
      run(
        {},
        delta({ op: "add", path: "/missing/x", value: 1 }),
        delta({ op: "replace", path: "/x", value: 1 }),
        delta({ op: "remove", path: "/x" }),
      ).diagnostics.map((d) => d.ruleId),
    ).toEqual(["STATE_PATCH", "STATE_PATCH", "STATE_PATCH"]));
  it("rejects moving a parent into its descendant", () =>
    expect(
      run({ a: { b: {} } }, delta({ op: "move", from: "/a", path: "/a/b/c" }))
        .diagnostics[0]?.ruleId,
    ).toBe("STATE_PATCH"));
  it("allows same-path move and moving a child to root", () =>
    expect(
      run(
        { a: { x: 1 } },
        delta(
          { op: "move", from: "/a", path: "/a" },
          { op: "move", from: "/a", path: "" },
          test("", { x: 1 }),
        ),
      ).diagnostics,
    ).toEqual([]));
  it("compares objects independent of key order", () =>
    expect(
      run({ a: 1, b: [2] }, delta(test("", { b: [2], a: 1 }))).diagnostics,
    ).toEqual([]));
  it("copies values without aliases", () =>
    expect(
      run(
        { a: { n: 1 } },
        delta(
          { op: "copy", from: "/a", path: "/b" },
          { op: "replace", path: "/a/n", value: 2 },
          test("/b/n", 1),
        ),
      ).diagnostics,
    ).toEqual([]));
  it("treats special property names as own JSON keys without prototype writes", () => {
    expect(
      run(
        {},
        delta(
          { op: "add", path: "/__proto__", value: { polluted: true } },
          test("/__proto__/polluted", true),
        ),
        delta({
          op: "add",
          path: "/constructor/prototype/polluted",
          value: true,
        }),
      ).diagnostics.map((d) => d.ruleId),
    ).toEqual(["STATE_PATCH"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("does not read inherited properties", () =>
    expect(run({}, delta(test("/toString", "x"))).diagnostics[0]?.ruleId).toBe(
      "STATE_PATCH",
    ));
  it("warns when input state was not recorded, then recovers on snapshot", () =>
    expect(
      codes([
        start,
        delta({ op: "add", path: "/n", value: 1 }),
        snap({ n: 2 }),
        delta(test("/n", 2)),
        finish,
      ]),
    ).toEqual(["STATE_BASELINE"]));
  it("uses input state as a baseline", () =>
    expect(
      codes([
        {
          ...start,
          input: {
            threadId: "t",
            runId: "r",
            messages: [],
            tools: [],
            context: [],
            forwardedProps: {},
            state: { n: 1 },
          },
        },
        delta(test("/n", 1)),
        finish,
      ]),
    ).toEqual([]));
  it("shares state with subagents and persists it per thread across runs", () =>
    expect(
      codes([
        start,
        snap({ n: 1 }),
        {
          ...delta({ op: "replace", path: "/n", value: 2 }),
          subagentRunId: "child",
        },
        finish,
        { ...start, runId: "next" },
        delta(test("/n", 2)),
        { ...finish, runId: "next" },
        { ...start, threadId: "other" },
        delta(test("/n", 2)),
        { ...finish, threadId: "other" },
      ]),
    ).toEqual(["STATE_BASELINE"]));
  it("new input overrides stored state and RUN_ERROR preserves prior state", () =>
    expect(
      codes([
        start,
        snap({ n: 1 }),
        { type: "RUN_ERROR", message: "x" },
        {
          ...start,
          runId: "next",
          input: {
            threadId: "t",
            runId: "next",
            messages: [],
            tools: [],
            context: [],
            forwardedProps: {},
            state: { n: 3 },
          },
        },
        delta(test("/n", 3)),
        { ...finish, runId: "next" },
      ]),
    ).toEqual([]));
  it("ignores rejected run boundaries and post-terminal state writes", () =>
    expect(
      codes([
        start,
        snap({ n: 1 }),
        { ...start, runId: "bad" },
        delta(test("/n", 1)),
        finish,
        snap({ n: 99 }),
        { ...start, runId: "next" },
        delta(test("/n", 1)),
        { ...finish, runId: "next" },
      ]),
    ).toEqual(["FL006", "RUN_TRANSITION"]));
  it("malformed operations fail schema validation without changing state", () =>
    expect(
      run(
        { n: 1 },
        delta({ op: "replace", path: "/n" }),
        delta(test("/n", 1)),
      ).diagnostics.map((d) => d.ruleId),
    ).toEqual(["SCHEMA_EVENT"]));
  it("allows extension members in operations", () =>
    expect(
      run(
        {},
        delta({ op: "add", path: "/n", value: 1, extension: "x" }),
        delta(test("/n", 1)),
      ).diagnostics,
    ).toEqual([]));
  it("an empty patch needs no baseline", () =>
    expect(codes([start, delta(), finish])).toEqual([]));
  it("does not leak state values, pointer text, or mutate input", () => {
    const events = [
      start,
      snap({ SECRET: 1 }),
      delta(test("/SECRET", "PRIVATE")),
      finish,
    ];
    const records = parseTrace(JSON.stringify(events));
    const before = JSON.stringify(records);
    const result = lintEvents(records);
    expect(JSON.stringify(records)).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE/);
  });
  it("bounds copy expansion and marks the baseline unknown", () => {
    const operations = Array.from({ length: 26 }, (_, i) => ({
      op: "copy",
      from: "",
      path: `/x${i}`,
    }));
    const result = run(
      { data: "x".repeat(1024) },
      delta(...operations),
      delta(test("", {})),
    );
    expect(result.diagnostics.map((d) => d.ruleId)).toEqual([
      "STATE_LIMIT",
      "STATE_BASELINE",
    ]);
  });
});
it("defaults a recorded input with no state to the empty object", () =>
  expect(
    codes([
      {
        ...start,
        input: {
          threadId: "t",
          runId: "r",
          messages: [],
          tools: [],
          context: [],
          forwardedProps: {},
        },
      },
      delta({ op: "add", path: "/n", value: 1 }, test("", { n: 1 })),
      finish,
    ]),
  ).toEqual([]));
it("recovers from an expansion limit with a small snapshot", () => {
  const result = run(
    { data: "x".repeat(1024) },
    delta(
      ...Array.from({ length: 26 }, (_, i) => ({
        op: "copy",
        from: "",
        path: `/x${i}`,
      })),
    ),
    snap({ n: 2 }),
    delta(test("/n", 2)),
  );
  expect(result.diagnostics.map((d) => d.ruleId)).toEqual(["STATE_LIMIT"]);
});
it("keeps other thread baselines when switching back", () =>
  expect(
    codes([
      start,
      snap({ n: 1 }),
      finish,
      { ...start, threadId: "other" },
      snap({ n: 2 }),
      { ...finish, threadId: "other" },
      { ...start, runId: "next" },
      delta(test("/n", 1)),
      { ...finish, runId: "next" },
    ]),
  ).toEqual([]));
