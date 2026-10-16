import { expect, it } from "vitest";
import { lintEvents, parseTrace } from "../src/index";
const start = { type: "RUN_STARTED", threadId: "t", runId: "r" };
const finish = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
const snap = (content: unknown = { n: 1 }, extra = {}) => ({
  type: "ACTIVITY_SNAPSHOT",
  messageId: "a",
  activityType: "progress",
  content,
  ...extra,
});
const delta = (...patch: unknown[]) => ({
  type: "ACTIVITY_DELTA",
  messageId: "a",
  activityType: "anything",
  patch,
});
const test = (value: unknown) => ({ op: "test", path: "/n", value });
const lint = (events: unknown[], allowPartial = false) =>
  lintEvents(parseTrace(JSON.stringify(events)), { allowPartial });
const run = (...events: unknown[]) =>
  lint([start, ...events, finish]).diagnostics;
it("applies all operations and allows retyping", () =>
  expect(
    run(
      snap(),
      delta(
        { op: "add", path: "/items", value: [1, 2] },
        { op: "copy", from: "/items", path: "/copy" },
        { op: "move", from: "/items/0", path: "/items/1" },
        { op: "replace", path: "/n", value: 2 },
        { op: "remove", path: "/copy" },
        test(2),
        { op: "test", path: "/items", value: [2, 1] },
      ),
    ),
  ).toEqual([]));
it("rolls back the whole patch on failure", () =>
  expect(
    run(
      snap(),
      delta(
        { op: "replace", path: "/n", value: 2 },
        { op: "remove", path: "/absent" },
      ),
      delta(test(1)),
    ),
  ).toMatchObject([{ ruleId: "ACTIVITY_PATCH", severity: "warning" }]));
it.each([null, [], 2, "secret"])(
  "rejects non-object result %j and retains content",
  (value) =>
    expect(
      run(snap(), delta({ op: "replace", path: "", value }), delta(test(1))),
    ).toMatchObject([{ ruleId: "ACTIVITY_CONTENT", severity: "error" }]),
);
it("checks final object shape, allowing intermediate scalars", () =>
  expect(
    run(
      snap(),
      delta(
        { op: "replace", path: "", value: null },
        { op: "replace", path: "", value: { n: 2 } },
      ),
      delta(test(2)),
    ),
  ).toEqual([]));
it("honors replace false and replacement defaults", () =>
  expect(
    run(
      snap({ n: 1 }, { replace: false }),
      snap({ n: 2 }, { replace: false }),
      delta(test(1)),
      snap({ n: 3 }),
      delta(test(3)),
    ),
  ).toEqual([]));
it("replacing snapshots re-mint ownership including parent ownership", () =>
  expect(
    run(
      snap({ n: 1 }, { subagentRunId: "child" }),
      snap({ n: 2 }),
      delta(test(2)),
      snap({ n: 3 }, { subagentRunId: "other" }),
      delta(test(3)),
    ),
  ).toEqual([]));
it("rejects conflicting preserved ownership without changing content", () =>
  expect(
    run(
      snap({ n: 1 }, { subagentRunId: "child" }),
      snap({ n: 2 }, { replace: false, subagentRunId: "other" }),
      { ...delta(test(1)), subagentRunId: "other" },
      delta(test(1)),
    ),
  ).toMatchObject([{ ruleId: "ATTRIBUTION" }, { ruleId: "ATTRIBUTION" }]));
it("warns for missing activity even on empty patches", () =>
  expect(run(delta())).toMatchObject([
    { ruleId: "ACTIVITY_BASELINE", severity: "warning" },
  ]));
it("preserves activities when a message snapshot contains no activities", () =>
  expect(
    run(snap(), { type: "MESSAGES_SNAPSHOT", messages: [] }, delta(test(1))),
  ).toEqual([]));
it("reconciles an authoritative activity set", () =>
  expect(
    run(
      snap(),
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [
          { id: "b", role: "activity", activityType: "other", content: {} },
        ],
      },
      delta(test(1)),
      { ...delta(), messageId: "b" },
    ),
  ).toMatchObject([{ ruleId: "ACTIVITY_BASELINE" }]));
it("replaces a same-ID non-activity and accepts history baselines", () =>
  expect(
    run(
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [
          {
            id: "a",
            role: "activity",
            activityType: "progress",
            content: { n: 4 },
          },
        ],
      },
      delta(test(4)),
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [{ id: "a", role: "assistant", content: "text" }],
      },
      delta(),
    ),
  ).toMatchObject([{ ruleId: "ACTIVITY_BASELINE" }]));
it("retains activities per thread across runs", () =>
  expect(
    lint([
      start,
      snap(),
      finish,
      { ...start, threadId: "other" },
      delta(),
      { ...finish, threadId: "other" },
      { ...start, runId: "next" },
      delta(test(1)),
      { ...finish, runId: "next" },
    ]).diagnostics,
  ).toMatchObject([{ ruleId: "ACTIVITY_BASELINE" }]));
it("supports partial captures without exposing values or mutating inputs", () => {
  const records = parseTrace(
    JSON.stringify([
      snap({ SECRET: 1 }),
      delta({ op: "test", path: "/SECRET", value: "PRIVATE" }),
    ]),
  );
  const before = JSON.stringify(records);
  const result = lintEvents(records, { allowPartial: true });
  expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE/);
  expect(JSON.stringify(records)).toBe(before);
  expect(result.diagnostics.some((d) => d.ruleId === "ACTIVITY_PATCH")).toBe(
    true,
  );
});
it("bounds expansion and recovers with a snapshot", () =>
  expect(
    run(
      snap({ data: "x".repeat(1024) }),
      delta(
        ...Array.from({ length: 26 }, (_, i) => ({
          op: "copy",
          from: "",
          path: `/x${i}`,
        })),
      ),
      delta(test(1)),
      snap(),
      delta(test(1)),
    ),
  ).toMatchObject([
    { ruleId: "ACTIVITY_LIMIT" },
    { ruleId: "ACTIVITY_BASELINE" },
  ]));
it("rejects malformed operations before mutating content", () =>
  expect(
    run(snap(), delta({ op: "replace", path: "/n" }), delta(test(1))),
  ).toMatchObject([{ ruleId: "SCHEMA_EVENT" }]));
it("shares the retained-content budget across activities", () => {
  const expand = Array.from({ length: 12 }, (_, i) => ({
    op: "copy",
    from: "",
    path: `/x${i}`,
  }));
  expect(
    run(
      snap({ data: "x".repeat(1500) }),
      delta(...expand),
      snap({ data: "x".repeat(1500) }, { messageId: "b" }),
      { ...delta(...expand), messageId: "b" },
      delta({ op: "test", path: "/data", value: "x".repeat(1500) }),
    ),
  ).toMatchObject([{ ruleId: "ACTIVITY_LIMIT" }]);
});
it("retains inherited ownership after run errors and across runs", () =>
  expect(
    lint([
      start,
      snap({ n: 1 }, { subagentRunId: "child" }),
      { type: "RUN_ERROR", message: "stopped" },
      { ...start, runId: "next" },
      { ...delta(test(1)), subagentRunId: "other" },
      delta(test(1)),
      { ...finish, runId: "next" },
    ]).diagnostics,
  ).toMatchObject([{ ruleId: "ATTRIBUTION" }]));
it("rejects post-terminal snapshots before changing content", () =>
  expect(
    lint([
      start,
      snap(),
      finish,
      snap({ n: 99 }),
      { ...start, runId: "next" },
      delta(test(1)),
      { ...finish, runId: "next" },
    ]).diagnostics,
  ).toMatchObject([{ ruleId: "RUN_TRANSITION" }]));
