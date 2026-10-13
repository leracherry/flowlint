import { describe, expect, it } from "vitest";
import { lintEvents, parseTrace } from "../src/index";
const start = { type: "RUN_STARTED", threadId: "t", runId: "r" };
const finish = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
const child = (id = "a", parent?: string) => ({
  type: "SUBAGENT_STARTED",
  subagentRunId: id,
  name: "worker",
  ...(parent === undefined ? {} : { parentSubagentRunId: parent }),
});
const done = (id = "a") => ({ type: "SUBAGENT_FINISHED", subagentRunId: id });
const message = (id = "m", owner?: string) => ({
  type: "TEXT_MESSAGE_START",
  messageId: id,
  role: "assistant",
  ...(owner === undefined ? {} : { subagentRunId: owner }),
});
const end = (id = "m", owner?: string) => ({
  type: "TEXT_MESSAGE_END",
  messageId: id,
  ...(owner === undefined ? {} : { subagentRunId: owner }),
});
const custom = (owner: string) => ({
  type: "CUSTOM",
  name: "x",
  value: {},
  subagentRunId: owner,
});
const lint = (events: unknown[], allowPartial = false) =>
  lintEvents(parseTrace(events.map((e) => JSON.stringify(e)).join("\n")), {
    allowPartial,
  });
const codes = (events: unknown[], partial = false) =>
  lint(events, partial).diagnostics.map((d) => d.ruleId);

describe("subagent lifecycle", () => {
  it("accepts parallel and nested invocations with interleaved explicit items", () => {
    expect(
      codes([
        start,
        child(),
        child("b"),
        child("c", "a"),
        message("parent"),
        message("ma", "a"),
        message("mb", "b"),
        end("mb"),
        done("b"),
        end("parent"),
        end("ma"),
        done("a"),
        done("c"),
        finish,
      ]),
    ).toEqual([]);
  });
  it.each(["SUBAGENT_FINISHED", "SUBAGENT_ERROR"])(
    "rejects duplicate terminals for %s",
    (type) => {
      const terminal = {
        type,
        subagentRunId: "a",
        ...(type === "SUBAGENT_ERROR" ? { message: "private" } : {}),
      };
      expect(codes([start, child(), terminal, terminal, finish])).toEqual([
        "SUBAGENT_END",
      ]);
    },
  );
  it.each([false, true])(
    "rejects duplicate starts and reuse (partial=%s)",
    (partial) => {
      expect(
        codes([start, child(), child(), done(), child(), finish], partial),
      ).toEqual(["SUBAGENT_START", "SUBAGENT_START"]);
    },
  );
  it("rejects a terminal without an announcement", () =>
    expect(codes([start, done(), finish])).toEqual(["SUBAGENT_END"]));
  it("reports every announced invocation still open at run finish", () =>
    expect(codes([start, child(), child("b"), finish])).toEqual([
      "SUBAGENT_OPEN",
      "SUBAGENT_OPEN",
    ]));
  it("accepts attributed-only producers without lifecycle events", () =>
    expect(
      codes([start, message("m", "a"), end(), custom("a"), finish]),
    ).toEqual([]));
  it("rejects a late announcement after attributed output", () =>
    expect(codes([start, custom("a"), child(), done(), finish])).toEqual([
      "SUBAGENT_START",
    ]));
  it("allows attributed output and nested starts after a parent subagent closes", () =>
    expect(
      codes([
        start,
        child(),
        done(),
        message("m", "a"),
        child("b", "a"),
        end(),
        done("b"),
        finish,
      ]),
    ).toEqual([]));
  it.each(["missing", "a"])("rejects unannounced/self parent %s", (parent) =>
    expect(codes([start, child("a", parent), done(), finish])).toEqual([
      "SUBAGENT_PARENT",
    ]),
  );
  it("RUN_ERROR abandons all invocations and items", () =>
    expect(
      codes([
        start,
        child(),
        message("m", "a"),
        { type: "RUN_ERROR", message: "private" },
      ]),
    ).toEqual([]));
  it("a child error does not abandon another producer's items", () =>
    expect(
      codes([
        start,
        message(),
        child(),
        { type: "SUBAGENT_ERROR", subagentRunId: "a", message: "private" },
        finish,
      ]),
    ).toEqual(["FL003"]));
  it("permits suspended invocation identity to reappear in a later run", () =>
    expect(
      codes([
        start,
        child(),
        { ...done(), outcome: { type: "suspended" } },
        finish,
        { ...start, runId: "next" },
        child(),
        done(),
        { ...finish, runId: "next" },
      ]),
    ).toEqual([]));
  it("partial excerpts warn for unseen announcements but reject repeated terminals", () => {
    const result = lint([done(), done()], true);
    expect(
      result.diagnostics
        .filter((d) => d.ruleId === "SUBAGENT_END")
        .map((d) => d.severity),
    ).toEqual(["warning", "error"]);
  });
  it("partial nesting permits a missing parent opener as a warning", () => {
    expect(
      lint([child("b", "a"), done("b")], true).diagnostics.find(
        (d) => d.ruleId === "SUBAGENT_PARENT",
      )?.severity,
    ).toBe("warning");
  });
  it("observed child starts establish item boundaries in excerpts", () =>
    expect(
      lint([child(), end("m", "a"), done()], true).diagnostics.find(
        (d) => d.ruleId === "FL002",
      )?.severity,
    ).toBe("error"));
  it.each([false, true])("EOF reports truncation (partial=%s)", (partial) =>
    expect(lint([start, child()], partial).diagnostics).toMatchObject([
      {
        ruleId: "FL012",
        severity: partial ? "warning" : "error",
        line: 2,
        eventIndex: 1,
      },
    ]),
  );
  it("preserves empty-string invocation IDs distinctly from the root", () =>
    expect(
      codes([start, child(""), message("m", ""), end(), done(""), finish]),
    ).toEqual([]));
  it("invalid schemas do not close an invocation", () =>
    expect(
      codes([
        start,
        child(),
        { type: "SUBAGENT_ERROR", subagentRunId: "a" },
        finish,
      ]),
    ).toEqual(["SCHEMA_EVENT", "SUBAGENT_OPEN"]));
});

describe("ownership", () => {
  it.each(["TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"])(
    "rejects %s owned by another producer without consuming the item",
    (type) => {
      expect(
        codes([
          start,
          message("m", "a"),
          {
            type,
            messageId: "m",
            subagentRunId: "b",
            ...(type.endsWith("CONTENT") ? { delta: "private" } : {}),
          },
          end(),
          finish,
        ]),
      ).toEqual(["FL011"]);
    },
  );
  it("also protects parent-owned messages", () =>
    expect(codes([start, message(), end("m", "a"), end(), finish])).toEqual([
      "FL011",
    ]));
  it("inherits a tool's owner from its parent message", () =>
    expect(
      codes([
        start,
        message("m", "a"),
        {
          type: "TOOL_CALL_START",
          toolCallId: "tool",
          toolCallName: "f",
          parentMessageId: "m",
        },
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: "tool",
          delta: "x",
          subagentRunId: "a",
        },
        { type: "TOOL_CALL_END", toolCallId: "tool" },
        end(),
        finish,
      ]),
    ).toEqual([]));
  it("rejects a conflicting parent on a reopened tool", () =>
    expect(
      codes([
        start,
        message("m", "a"),
        message("other", "b"),
        {
          type: "TOOL_CALL_START",
          toolCallId: "tool",
          toolCallName: "f",
          parentMessageId: "m",
        },
        { type: "TOOL_CALL_END", toolCallId: "tool" },
        {
          type: "TOOL_CALL_START",
          toolCallId: "tool",
          toolCallName: "f",
          parentMessageId: "other",
        },
        end(),
        end("other"),
        finish,
      ]),
    ).toEqual(["FL011"]));
  it.each(["TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT"])(
    "checks %s attribution",
    (type) => {
      const event = {
        type,
        toolCallId: "tool",
        subagentRunId: "b",
        ...(type === "TOOL_CALL_ARGS"
          ? { delta: "x" }
          : type === "TOOL_CALL_RESULT"
            ? { messageId: "result", content: "x" }
            : {}),
      };
      expect(
        codes([
          start,
          {
            type: "TOOL_CALL_START",
            toolCallId: "tool",
            toolCallName: "f",
            subagentRunId: "a",
          },
          event,
          { type: "TOOL_CALL_END", toolCallId: "tool" },
          finish,
        ]),
      ).toEqual(["FL011"]);
    },
  );
  it.each(["REASONING_MESSAGE_CONTENT", "REASONING_MESSAGE_END"])(
    "checks %s ownership while preserving the open message",
    (type) =>
      expect(
        codes([
          start,
          {
            type: "REASONING_MESSAGE_START",
            messageId: "r",
            role: "reasoning",
            subagentRunId: "a",
          },
          {
            type,
            messageId: "r",
            subagentRunId: "b",
            ...(type.endsWith("CONTENT") ? { delta: "private" } : {}),
          },
          finish,
        ]),
      ).toEqual(["ATTRIBUTION", "REASONING_MESSAGE_OPEN"]),
  );
  it("checks activity ownership and accepts omitted tags", () =>
    expect(
      codes([
        start,
        {
          type: "ACTIVITY_SNAPSHOT",
          messageId: "act",
          activityType: "test",
          content: {},
          subagentRunId: "a",
        },
        {
          type: "ACTIVITY_DELTA",
          messageId: "act",
          activityType: "test",
          patch: [],
        },
        {
          type: "ACTIVITY_DELTA",
          messageId: "act",
          activityType: "test",
          patch: [],
          subagentRunId: "b",
        },
        finish,
      ]),
    ).toEqual(["ATTRIBUTION"]));
  it("keeps same-named steps separate per producer", () =>
    expect(
      codes([
        start,
        { type: "STEP_STARTED", stepName: "s" },
        { type: "STEP_STARTED", stepName: "s", subagentRunId: "a" },
        { type: "STEP_FINISHED", stepName: "s", subagentRunId: "a" },
        { type: "STEP_FINISHED", stepName: "s" },
        finish,
      ]),
    ).toEqual([]));
  it("does not infer step ownership for an untagged finish", () =>
    expect(
      codes([
        start,
        { type: "STEP_STARTED", stepName: "s", subagentRunId: "" },
        { type: "STEP_FINISHED", stepName: "s" },
        finish,
      ]),
    ).toEqual(["ATTRIBUTION", "STEP_OPEN"]));
  it("reads historical ownership from message snapshots without requiring announcements", () =>
    expect(
      codes([
        start,
        {
          type: "MESSAGES_SNAPSHOT",
          messages: [
            {
              id: "m",
              role: "assistant",
              content: "",
              subagentRunId: "a",
              toolCalls: [
                {
                  id: "tool",
                  type: "function",
                  function: { name: "f", arguments: "" },
                },
              ],
            },
          ],
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "tool",
          messageId: "result",
          content: "x",
          subagentRunId: "b",
        },
        finish,
      ]),
    ).toEqual(["FL011"]));
  it("does not mutate input events or expose payloads", () => {
    const events = [
      start,
      message("m", "a"),
      {
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "m",
        subagentRunId: "b",
        delta: "SECRET",
      },
      end(),
      finish,
    ];
    const before = JSON.stringify(events);
    const result = lint(events);
    expect(JSON.stringify(events)).toBe(before);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result.diagnostics[0]).toMatchObject({
      line: 3,
      column: 1,
      eventIndex: 2,
    });
  });
});

it("retains sibling explicit items when a child terminal closes its chunk lane", () => {
  expect(
    codes([
      start,
      child(),
      message("sibling", "b"),
      {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: "chunk",
        subagentRunId: "a",
        delta: "x",
      },
      done(),
      end("sibling"),
      finish,
    ]),
  ).toEqual([]);
});
it("retains child explicit items after its terminal until their own ends arrive", () =>
  expect(
    codes([start, child(), message("m", "a"), done(), end(), finish]),
  ).toEqual([]));
it("rejects conflicting reopened message ownership", () =>
  expect(
    codes([start, message("m", "a"), end(), message("m", "b"), finish]),
  ).toEqual(["FL011"]));
it("rejected nested run starts do not lose chunk ownership", () =>
  expect(
    codes([
      start,
      {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: "m",
        subagentRunId: "a",
        delta: "x",
      },
      { ...start, runId: "bad" },
      { type: "TEXT_MESSAGE_CHUNK", delta: "y" },
      finish,
    ]),
  ).toEqual(["FL006"]));
it("rejected mismatched run finishes do not close child chunk lanes", () =>
  expect(
    codes([
      start,
      {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: "m",
        subagentRunId: "a",
        delta: "x",
      },
      { ...finish, runId: "bad" },
      { type: "TEXT_MESSAGE_CHUNK", delta: "y" },
      finish,
    ]),
  ).toEqual(["RUN_IDENTITY"]));
it("observed child boundaries reject missing chunk openers in excerpts", () =>
  expect(
    lint(
      [
        child(),
        { type: "TEXT_MESSAGE_CHUNK", subagentRunId: "a", delta: "x" },
        done(),
      ],
      true,
    ).diagnostics.find((d) => d.ruleId === "FL010")?.severity,
  ).toBe("error"));
it("snapshot ownership updates are shared with chunk normalization", () =>
  expect(
    codes([
      start,
      {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: "m",
        subagentRunId: "a",
        delta: "x",
      },
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [
          { id: "m", role: "assistant", content: "", subagentRunId: "b" },
        ],
      },
      {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: "m",
        subagentRunId: "b",
        delta: "y",
      },
      finish,
    ]),
  ).toEqual([]));
it.each([
  [
    { id: "r", role: "reasoning", content: "", subagentRunId: "a" },
    { type: "REASONING_MESSAGE_END", messageId: "r", subagentRunId: "b" },
  ],
  [
    {
      id: "act",
      role: "activity",
      activityType: "test",
      content: {},
      subagentRunId: "a",
    },
    {
      type: "ACTIVITY_DELTA",
      messageId: "act",
      activityType: "test",
      patch: [],
      subagentRunId: "b",
    },
  ],
])("seeds snapshot entity ownership by role", (message, continuation) =>
  expect(
    codes([
      start,
      { type: "MESSAGES_SNAPSHOT", messages: [message] },
      continuation,
      finish,
    ]),
  ).toEqual(["ATTRIBUTION"]),
);
it("seeds input message ownership at run start", () =>
  expect(
    codes([
      {
        ...start,
        input: {
          threadId: "t",
          runId: "r",
          state: {},
          messages: [
            { id: "m", role: "assistant", content: "", subagentRunId: "a" },
          ],
          tools: [],
          context: [],
          forwardedProps: {},
        },
      },
      {
        type: "TOOL_CALL_START",
        toolCallId: "tool",
        toolCallName: "f",
        parentMessageId: "m",
      },
      { type: "TOOL_CALL_END", toolCallId: "tool", subagentRunId: "a" },
      finish,
    ]),
  ).toEqual([]));
