import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lintEvents, parseTrace, SUPPORTED_RULES } from "../src/index";
const start = { type: "RUN_STARTED", threadId: "thread", runId: "run" };
const finish = { type: "RUN_FINISHED", threadId: "thread", runId: "run" };
const message = {
  type: "TEXT_MESSAGE_START",
  messageId: "m",
  role: "assistant",
};
const content = {
  type: "TEXT_MESSAGE_CONTENT",
  messageId: "m",
  delta: "PRIVATE_BODY",
};
const end = { type: "TEXT_MESSAGE_END", messageId: "m" };
const tool = {
  type: "TOOL_CALL_START",
  toolCallId: "t",
  toolCallName: "search",
};
const args = { type: "TOOL_CALL_ARGS", toolCallId: "t", delta: "PRIVATE_ARGS" };
const toolEnd = { type: "TOOL_CALL_END", toolCallId: "t" };
const error = { type: "RUN_ERROR", message: "PRIVATE_ERROR" };
const lint = (events: unknown[], allowPartial = false) =>
  lintEvents(parseTrace(events.map((e) => JSON.stringify(e)).join("\n")), {
    allowPartial,
  });
const codes = (events: unknown[], partial = false) =>
  lint(events, partial).diagnostics.map((d) => d.ruleId);
describe("milestone 2 fixtures", () => {
  const rules = [
    "FL001",
    "FL002",
    "FL003",
    "FL004",
    "FL005",
    "FL006",
    "FL007",
    "FL008",
    "FL009",
    "FL012",
  ];
  it.each(rules)("%s rejects an invalid fixture at its source", (rule) => {
    const text = readFileSync(`test/fixtures/invalid/${rule}.json`, "utf8");
    const records = parseTrace(text);
    const result = lintEvents(records);
    expect(result.valid).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.ruleId === rule)!;
    expect(diagnostic).toBeDefined();
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.line).toBe(records[diagnostic.eventIndex!]!.line);
    expect(result.diagnostics.some((d) => d.ruleId === "SCHEMA_EVENT")).toBe(
      false,
    );
  });
  it.each(rules)("%s accepts a valid fixture", (rule) => {
    const result = lintEvents(
      parseTrace(readFileSync(`test/fixtures/valid/${rule}.json`, "utf8")),
    );
    expect(result.diagnostics).toEqual([]);
  });
});
describe("protocol and boundary regressions", () => {
  it("reports supported rules consistently", () =>
    expect(lint([start, finish]).supportedRules).toEqual(SUPPORTED_RULES));
  it("reports unopened text and tool ends", () =>
    expect(codes([start, end, toolEnd, finish])).toEqual(["FL002", "FL005"]));
  it("reports every item still open at finish", () =>
    expect(
      codes([
        start,
        { ...message, messageId: "m2" },
        message,
        tool,
        { ...tool, toolCallId: "t2" },
        finish,
      ]),
    ).toEqual(["FL003", "FL003", "FL009", "FL009"]));
  it("keeps separate messages and tools open concurrently", () =>
    expect(
      lint([
        start,
        message,
        { ...message, messageId: "other" },
        tool,
        content,
        args,
        end,
        toolEnd,
        { ...end, messageId: "other" },
        finish,
      ]).diagnostics,
    ).toEqual([]));
  it("accepts tool results without imposing an execution lifecycle", () =>
    expect(
      lint([
        start,
        tool,
        args,
        toolEnd,
        {
          type: "TOOL_CALL_RESULT",
          messageId: "result",
          toolCallId: "t",
          content: "PRIVATE_RESULT",
        },
        finish,
      ]).valid,
    ).toBe(true));
  it("accepts pending frontend tools and non-JSON argument fragments", () =>
    expect(
      lint([
        start,
        tool,
        args,
        toolEnd,
        { ...finish, outcome: { type: "success", pendingToolCallIds: ["t"] } },
      ]).valid,
    ).toBe(true));
  it.each([
    { type: "cancelled" },
    { type: "interrupt", interrupts: [{ id: "i", reason: "approval" }] },
  ])("accepts closed %j runs without requiring a resume", (outcome) =>
    expect(lint([start, message, end, { ...finish, outcome }]).valid).toBe(
      true,
    ),
  );
  it.each([
    { type: "cancelled" },
    { type: "interrupt", interrupts: [{ id: "i", reason: "approval" }] },
  ])("requires item closure for %j runs", (outcome) =>
    expect(codes([start, message, tool, { ...finish, outcome }])).toEqual([
      "FL003",
      "FL009",
    ]),
  );
  it("RUN_ERROR abandons open items without lint failure", () =>
    expect(lint([start, message, tool, error]).diagnostics).toEqual([]));
  it("allows a late error only after a finished run", () => {
    expect(lint([start, finish, error]).diagnostics).toEqual([]);
    expect(codes([error, error])).toEqual(["RUN_TRANSITION"]);
  });
  it("disallows ordinary events and repeated finishes after a terminal", () => {
    expect(codes([start, finish, content, finish])).toEqual([
      "RUN_TRANSITION",
      "RUN_TRANSITION",
    ]);
    expect(codes([start, error, message])).toEqual(["RUN_TRANSITION"]);
  });
  it.each([
    { ...finish, runId: "wrong" },
    { ...finish, threadId: "wrong" },
  ])("rejects a mismatched finish and preserves active state", (terminal) =>
    expect(codes([start, terminal, finish])).toEqual(["RUN_IDENTITY"]),
  );
  it("does not discard open items at a rejected nested start", () =>
    expect(
      codes([start, message, { ...start, runId: "next" }, finish]),
    ).toEqual(["FL006", "FL003"]));
  it("tracks IDs per thread without concatenation collisions", () =>
    expect(
      lint([
        { ...start, threadId: "a:b", runId: "c" },
        { ...finish, threadId: "a:b", runId: "c" },
        { ...start, threadId: "a", runId: "b:c" },
        { ...finish, threadId: "a", runId: "b:c" },
      ]).valid,
    ).toBe(true));
  it("retains run identity history after an error", () =>
    expect(codes([start, error, start, finish])).toEqual(["FL007"]));
  it("never sorts events by timestamps", () =>
    expect(
      lint([
        start,
        { ...message, timestamp: 30 },
        { ...content, timestamp: 10 },
        { ...end, timestamp: 20 },
        finish,
      ]).valid,
    ).toBe(true));
  it("accepts supported but unchecked event families inside runs", () =>
    expect(
      lint([
        start,
        { type: "RAW", event: {} },
        { type: "CUSTOM", name: "example", value: {} },
        { type: "STATE_SNAPSHOT", snapshot: {} },
        finish,
      ]).valid,
    ).toBe(true));
  it("partial excerpts warn at missing openers and accept observed terminal", () => {
    const result = lint([content, args, end, toolEnd, finish], true);
    expect(result.valid).toBe(true);
    expect(result.diagnostics.every((d) => d.severity === "warning")).toBe(
      true,
    );
  });
  it("partial mode downgrades EOF truncation", () => {
    expect(lint([start, message, tool], true).diagnostics).toMatchObject([
      { ruleId: "FL012", severity: "warning", line: 3 },
    ]);
    expect(lint([start, message, tool]).diagnostics).toMatchObject([
      { ruleId: "FL012", severity: "error", line: 3 },
    ]);
  });
  it.each([
    [start, content, finish],
    [start, args, finish],
    [start, message, message, end, finish],
    [start, tool, tool, toolEnd, finish],
    [start, message, finish],
    [start, tool, finish],
  ])("retains observed contradictions in partial mode %#", (...events) =>
    expect(lint(events, true).valid).toBe(false),
  );
  it("an observed end proves later content is invalid even in an excerpt", () =>
    expect(
      lint([end, content, finish], true).diagnostics.find(
        (d) => d.ruleId === "FL002" && d.eventIndex === 1,
      )?.severity,
    ).toBe("error"));
  it("a completed excerpt establishes a new boundary", () =>
    expect(
      lint([finish, content], true).diagnostics.find(
        (d) => d.ruleId === "RUN_TRANSITION" && d.eventIndex === 1,
      )?.severity,
    ).toBe("error"));
  it("does not retain message, tool argument or error bodies", () => {
    const text = JSON.stringify(lint([start, content, args, error]));
    expect(text).not.toMatch(/PRIVATE_BODY|PRIVATE_ARGS|PRIVATE_ERROR/);
  });
  it("skips invalid terminals without silently closing a run", () =>
    expect(codes([start, { type: "RUN_FINISHED" }])).toEqual([
      "FL012",
      "SCHEMA_EVENT",
    ]));
  it("normalizes chunks while keeping independent explicit closures and EOF checks", () => {
    expect(
      codes([
        start,
        { type: "TEXT_MESSAGE_CHUNK", messageId: "m", delta: "Hi" },
        tool,
        finish,
      ]),
    ).toEqual(["FL009"]);
    expect(
      codes([
        start,
        message,
        {
          type: "TOOL_CALL_CHUNK",
          toolCallId: "t",
          toolCallName: "search",
          delta: "x",
        },
        finish,
      ]),
    ).toEqual(["FL003"]);
    expect(
      codes([start, { type: "TEXT_MESSAGE_CHUNK", messageId: "m" }]),
    ).toEqual(["FL012"]);
  });
  it("resets chunk state at the next run", () =>
    expect(
      codes([
        start,
        { type: "TEXT_MESSAGE_CHUNK", messageId: "m" },
        finish,
        { ...start, runId: "next" },
        content,
        { ...finish, runId: "next" },
      ]),
    ).toEqual(["FL002"]));
  it("checks implicitly attributed subagent items at run finish", () =>
    expect(
      codes([
        start,
        { ...message, subagentRunId: "child" },
        { ...tool, parentMessageId: "m" },
        finish,
      ]),
    ).toEqual(["FL003", "FL009"]));
});
