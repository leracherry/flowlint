import { describe, expect, it } from "vitest";
import { EventSchemas } from "@ag-ui/core/schemas";
import { readFileSync } from "node:fs";
import { lintEvents, parseTrace } from "../src/index";
import { ChunkNormalizer } from "../src/normalize-chunks";
const start = { type: "RUN_STARTED", threadId: "thread", runId: "run" };
const finish = { type: "RUN_FINISHED", threadId: "thread", runId: "run" };
const text = {
  type: "TEXT_MESSAGE_CHUNK",
  messageId: "m",
  delta: "PRIVATE_BODY",
};
const tool = {
  type: "TOOL_CALL_CHUNK",
  toolCallId: "t",
  toolCallName: "search",
  delta: "PRIVATE_ARGS",
};
const lint = (events: unknown[], allowPartial = false) =>
  lintEvents(parseTrace(events.map((e) => JSON.stringify(e)).join("\n")), {
    allowPartial,
  });
const codes = (events: unknown[], partial = false) =>
  lint(events, partial).diagnostics.map((d) => d.ruleId);
const normalize = (events: unknown[]) => {
  const normalizer = new ChunkNormalizer(() => {});
  return parseTrace(JSON.stringify(events)).flatMap((record) =>
    normalizer.push(EventSchemas.parse(record.event), record),
  );
};
describe("chunk triad expansion", () => {
  it.each([text, tool])(
    "opens, continues and closes %j at run finish",
    (chunk) => {
      const continuation = { type: chunk.type, delta: "tail" };
      expect(lint([start, chunk, continuation, finish]).diagnostics).toEqual(
        [],
      );
      expect(
        normalize([start, chunk, continuation, finish]).map((e) => e.type),
      ).toEqual(
        chunk.type === "TEXT_MESSAGE_CHUNK"
          ? [
              "RUN_STARTED",
              "TEXT_MESSAGE_START",
              "TEXT_MESSAGE_CONTENT",
              "TEXT_MESSAGE_CONTENT",
              "TEXT_MESSAGE_END",
              "RUN_FINISHED",
            ]
          : [
              "RUN_STARTED",
              "TOOL_CALL_START",
              "TOOL_CALL_ARGS",
              "TOOL_CALL_ARGS",
              "TOOL_CALL_END",
              "RUN_FINISHED",
            ],
      );
    },
  );
  it("defaults text role to assistant and preserves chunk metadata", () => {
    const result = normalize([
      start,
      { ...text, metadata: { usage: 1 }, timestamp: 5 },
      finish,
    ]);
    expect(result[1]).toMatchObject({
      role: "assistant",
      metadata: { usage: 1 },
      timestamp: 5,
    });
    expect(result[2]).toMatchObject({ metadata: { usage: 1 }, timestamp: 5 });
    expect(result.every((e) => EventSchemas.safeParse(e).success)).toBe(true);
  });
  it("accepts metadata-only and empty-delta continuations without invalid synthetic content", () => {
    expect(
      lint([
        start,
        text,
        { type: text.type, metadata: { usage: 1 } },
        { type: text.type, delta: "" },
        finish,
      ]).diagnostics,
    ).toEqual([]);
    expect(
      normalize([start, { type: text.type, messageId: "m" }, finish]).map(
        (e) => e.type,
      ),
    ).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_END",
      "RUN_FINISHED",
    ]);
  });
  it.each([
    { ...text, messageId: "new" },
    { ...tool, toolCallId: "new" },
  ])("identifier changes open a new item rather than conflict %j", (next) => {
    expect(
      lint([start, next.type === text.type ? text : tool, next, finish])
        .diagnostics,
    ).toEqual([]);
  });
  it("switching families in a lane closes the previous stream", () => {
    expect(
      lint([start, text, tool, { ...text, messageId: "next" }, finish])
        .diagnostics,
    ).toEqual([]);
    expect(normalize([start, text, tool, finish]).map((e) => e.type)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "RUN_FINISHED",
    ]);
  });
  it.each(["RUN_FINISHED", "RUN_ERROR", "MESSAGES_SNAPSHOT"])(
    "closes chunks at global %s",
    (type) => {
      const boundary =
        type === "RUN_FINISHED"
          ? finish
          : type === "RUN_ERROR"
            ? { type, message: "failed" }
            : { type, messages: [] };
      expect(normalize([start, tool, boundary]).map((e) => e.type)).toContain(
        "TOOL_CALL_END",
      );
    },
  );
  it.each([
    { type: "RAW", event: {} },
    {
      type: "ACTIVITY_SNAPSHOT",
      messageId: "a",
      activityType: "test",
      content: {},
    },
    { type: "ACTIVITY_DELTA", messageId: "a", activityType: "test", patch: [] },
    {
      type: "REASONING_ENCRYPTED_VALUE",
      subtype: "message",
      entityId: "m",
      encryptedValue: "opaque",
    },
  ])("stand-aside event %j does not close chunks", (event) => {
    expect(
      lint([
        start,
        {
          type: "ACTIVITY_SNAPSHOT",
          messageId: "a",
          activityType: "test",
          content: {},
        },
        text,
        event,
        { type: text.type, delta: "tail" },
        finish,
      ]).diagnostics,
    ).toEqual([]);
  });
  it.each([
    { type: "CUSTOM", name: "x", value: {} },
    { type: "STATE_SNAPSHOT", snapshot: {} },
    { type: "STEP_STARTED", stepName: "step" },
    { type: "REASONING_MESSAGE_START", messageId: "reason", role: "reasoning" },
  ])("same-lane %j closes chunks", (event) => {
    expect(
      codes([start, text, event, { type: text.type, delta: "tail" }, finish]),
    ).toEqual([
      "FL010",
      ...(event.type === "STEP_STARTED"
        ? ["STEP_OPEN"]
        : event.type === "REASONING_MESSAGE_START"
          ? ["REASONING_MESSAGE_OPEN"]
          : []),
    ]);
  });
  it("a tool result closes shorthand without being treated as mixed triad form", () =>
    expect(
      lint([
        start,
        tool,
        {
          type: "TOOL_CALL_RESULT",
          messageId: "r",
          toolCallId: "t",
          content: "result",
        },
        finish,
      ]).diagnostics,
    ).toEqual([]));
  it("does not silently close an explicit item alongside a chunk", () =>
    expect(
      codes([
        start,
        { type: "TEXT_MESSAGE_START", messageId: "explicit" },
        tool,
        finish,
      ]),
    ).toEqual(["FL003"]));
});
describe("FL010 and FL011", () => {
  it.each([
    { type: text.type },
    { type: tool.type },
    { type: tool.type, toolCallId: "t" },
    { type: tool.type, toolCallName: "search" },
  ])("rejects missing opening fields %j", (chunk) =>
    expect(codes([start, chunk, finish])).toEqual(["FL010"]),
  );
  it.each([
    { ...text, role: "user" },
    { ...text, name: "changed" },
    { ...tool, toolCallName: "changed" },
    { ...tool, parentMessageId: "changed" },
  ])(
    "rejects conflicting repeats without exposing field values %j",
    (continuation) => {
      const opener = continuation.type === text.type ? text : tool;
      const result = lint([start, opener, continuation, finish]);
      expect(result.diagnostics).toMatchObject([
        { ruleId: "FL011", severity: "error", eventIndex: 2, line: 3 },
      ]);
      expect(JSON.stringify(result)).not.toMatch(
        /PRIVATE_BODY|PRIVATE_ARGS|changed/,
      );
    },
  );
  it("accepts consistent repeated fields", () =>
    expect(
      lint([
        start,
        { ...text, role: "user", name: "speaker" },
        { type: text.type, role: "user", name: "speaker" },
        { ...tool, parentMessageId: "m" },
        { type: tool.type, toolCallName: "search", parentMessageId: "m" },
        finish,
      ]).diagnostics,
    ).toEqual([]));
  it.each([
    { type: "TEXT_MESSAGE_START", messageId: "m" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "x" },
    { type: "TEXT_MESSAGE_END", messageId: "m" },
  ])("rejects chunk-to-explicit mixing %j", (event) =>
    expect(codes([start, text, event, finish])).toContain("FL011"),
  );
  it.each([
    { type: "TOOL_CALL_START", toolCallId: "t", toolCallName: "search" },
    { type: "TOOL_CALL_ARGS", toolCallId: "t", delta: "x" },
    { type: "TOOL_CALL_END", toolCallId: "t" },
  ])("rejects tool chunk-to-explicit mixing %j", (event) =>
    expect(codes([start, tool, event, finish])).toContain("FL011"),
  );
  it.each([
    { type: "TEXT_MESSAGE_START", messageId: "m" },
    { type: "TOOL_CALL_START", toolCallId: "t", toolCallName: "search" },
  ])("rejects explicit-to-chunk mixing %j", (opener) =>
    expect(
      codes([
        start,
        opener,
        opener.type === "TEXT_MESSAGE_START" ? text : tool,
        finish,
      ]),
    ).toContain("FL011"),
  );
  it("partial capture warns for a missing opener but not conflicting repeats", () => {
    expect(lint([{ type: text.type, delta: "tail" }, finish], true).valid).toBe(
      true,
    );
    expect(
      lint([start, { type: text.type, delta: "tail" }, finish], true).valid,
    ).toBe(false);
    expect(
      lint([text, { type: text.type, role: "user" }, finish], true).valid,
    ).toBe(false);
  });
  it("observed lane boundaries prove missing openers are errors in excerpts", () =>
    expect(
      lint(
        [
          text,
          { type: "CUSTOM", name: "x", value: {} },
          { type: text.type, delta: "x" },
          finish,
        ],
        true,
      ).diagnostics.find((d) => d.ruleId === "FL010")?.severity,
    ).toBe("error"));
  it("EOF is truncation rather than an implicit successful close", () => {
    expect(codes([start, text])).toEqual(["FL012"]);
    expect(lint([start, text], true).valid).toBe(true);
  });
  it("skips schema-invalid chunks without changing normalization state", () =>
    expect(
      codes([
        start,
        text,
        { type: text.type, delta: 3 },
        { type: text.type, delta: "tail" },
        finish,
      ]),
    ).toEqual(["SCHEMA_EVENT"]));
  it.each(["FL010", "FL011"])(
    "uses source locations in %s fixtures",
    (rule) => {
      const records = parseTrace(
        readFileSync(`test/fixtures/invalid/${rule}.json`, "utf8"),
      );
      const diagnostic = lintEvents(records).diagnostics.find(
        (d) => d.ruleId === rule,
      )!;
      expect(diagnostic).toBeDefined();
      expect(diagnostic.line).toBe(records[diagnostic.eventIndex!]!.line);
      expect(
        lintEvents(
          parseTrace(readFileSync(`test/fixtures/valid/${rule}.json`, "utf8")),
        ).diagnostics,
      ).toEqual([]);
    },
  );
});
describe("lanes and compatibility", () => {
  it("interleaves parent and subagent chunks without closing other lanes", () => {
    const result = lint([
      start,
      text,
      { ...tool, subagentRunId: "child" },
      { type: text.type, delta: "root" },
      { type: tool.type, subagentRunId: "child", delta: "child" },
      finish,
    ]);
    expect(result.valid).toBe(true);
    expect(result.diagnostics.map((d) => d.ruleId)).toEqual([]);
  });
  it("untagged continuation prefers the parent stream", () => {
    const result = normalize([
      start,
      text,
      { ...text, messageId: "child-message", subagentRunId: "child" },
      { type: text.type, delta: "tail" },
      finish,
    ]);
    expect(
      result.find(
        (e) => e.type === "TEXT_MESSAGE_CONTENT" && e.delta === "tail",
      ),
    ).toMatchObject({ messageId: "m" });
  });
  it("untagged continuation selects the sole child stream if no parent exists", () =>
    expect(
      lint([
        start,
        { ...text, subagentRunId: "child" },
        { type: text.type, delta: "tail" },
        finish,
      ]).valid,
    ).toBe(true));
  it("rejects ambiguous untagged continuations across child lanes", () =>
    expect(
      codes([
        start,
        { ...text, subagentRunId: "a" },
        { ...text, messageId: "other", subagentRunId: "b" },
        { type: text.type, delta: "tail" },
        finish,
      ]),
    ).toContain("FL011"));
  it("identifier-only continuations resolve ownership", () =>
    expect(
      lint([
        start,
        { ...text, subagentRunId: "a" },
        { ...text, messageId: "other", subagentRunId: "b" },
        { type: text.type, messageId: "m", delta: "tail" },
        finish,
      ]).valid,
    ).toBe(true));
  it("rejects changed attribution for an established identifier", () =>
    expect(
      codes([
        start,
        { ...text, subagentRunId: "a" },
        { ...text, subagentRunId: "b" },
        finish,
      ]),
    ).toContain("FL011"));
  it("inherits tool chunk ownership from its parent message", () => {
    const result = normalize([
      start,
      { ...text, subagentRunId: "a" },
      { ...tool, parentMessageId: "m" },
      { type: tool.type, delta: "tail" },
      finish,
    ]);
    expect(result.find((e) => e.type === "TOOL_CALL_START")).toMatchObject({
      subagentRunId: "a",
    });
  });
  it("rejects tool parent ownership conflicts", () =>
    expect(
      codes([
        start,
        { ...text, subagentRunId: "a" },
        { ...tool, parentMessageId: "m", subagentRunId: "b" },
        finish,
      ]),
    ).toContain("FL011"));
  it.each(["SUBAGENT_FINISHED", "SUBAGENT_ERROR"])(
    "%s closes only that owner lane",
    (type) => {
      const terminal = {
        type,
        subagentRunId: "a",
        ...(type === "SUBAGENT_ERROR" ? { message: "failed" } : {}),
      };
      const result = lint([
        start,
        { type: "SUBAGENT_STARTED", subagentRunId: "a", name: "worker" },
        { ...text, subagentRunId: "a" },
        { ...tool, subagentRunId: "b" },
        terminal,
        { type: tool.type, subagentRunId: "b", delta: "tail" },
        finish,
      ]);
      expect(result.valid).toBe(true);
      expect(
        codes([
          start,
          { ...text, subagentRunId: "a" },
          terminal,
          { type: text.type, subagentRunId: "a", delta: "tail" },
          finish,
        ]),
      ).toContain("FL010");
    },
  );
  it("SUBAGENT_STARTED does not close parent chunks", () =>
    expect(
      lint([
        start,
        text,
        { type: "SUBAGENT_STARTED", subagentRunId: "a", name: "worker" },
        { type: text.type, delta: "tail" },
        { type: "SUBAGENT_FINISHED", subagentRunId: "a" },
        finish,
      ]).valid,
    ).toBe(true));
  it("normalizes reasoning chunks and treats them as a lane boundary", () => {
    expect(
      codes([
        start,
        text,
        { type: "REASONING_MESSAGE_CHUNK", messageId: "r", delta: "reason" },
        { type: text.type, delta: "tail" },
        finish,
      ]),
    ).toEqual(["FL010"]);
  });
});
it("forwards metadata-only continuations as valid empty content without retaining metadata", () => {
  const result = normalize([
    start,
    text,
    { type: text.type, metadata: { usage: 5 } },
    finish,
  ]);
  expect(result[3]).toMatchObject({
    type: "TEXT_MESSAGE_CONTENT",
    messageId: "m",
    delta: "",
    metadata: { usage: 5 },
  });
  expect(result.every((e) => EventSchemas.safeParse(e).success)).toBe(true);
});
it("keeps input event counts unchanged by synthetic transitions", () =>
  expect(lint([start, text, tool, finish]).checkedEvents).toBe(4));
it("synthetic lifecycle failures retain the originating chunk line", () => {
  const result = lint([
    start,
    { type: "TEXT_MESSAGE_START", messageId: "m" },
    text,
    finish,
  ]);
  expect(result.diagnostics.find((d) => d.ruleId === "FL011")).toMatchObject({
    line: 3,
    eventIndex: 2,
  });
});
it("changing a tool ID requires a new name rather than borrowing the previous opener", () =>
  expect(
    codes([
      start,
      tool,
      { type: tool.type, toolCallId: "new", delta: "x" },
      finish,
    ]),
  ).toEqual(["FL010"]));
it("a standalone child event does not close the parent lane", () =>
  expect(
    lint([
      start,
      text,
      { type: "CUSTOM", name: "x", value: {}, subagentRunId: "child" },
      { type: text.type, delta: "tail" },
      finish,
    ]).valid,
  ).toBe(true));
it("global snapshots close every lane", () => {
  const result = normalize([
    start,
    text,
    { ...tool, subagentRunId: "child" },
    { type: "MESSAGES_SNAPSHOT", messages: [] },
  ]);
  expect(result.slice(-3).map((e) => e.type)).toEqual([
    "TEXT_MESSAGE_END",
    "TOOL_CALL_END",
    "MESSAGES_SNAPSHOT",
  ]);
});
it("untagged reasoning continuations do not close a different owner lane", () => {
  const result = lint([
    start,
    text,
    {
      type: "REASONING_MESSAGE_CHUNK",
      messageId: "r",
      subagentRunId: "child",
      delta: "x",
    },
    { type: "REASONING_MESSAGE_CHUNK", delta: "y" },
    { type: text.type, delta: "tail" },
    finish,
  ]);
  expect(result.valid).toBe(true);
  expect(result.diagnostics.map((d) => d.ruleId)).toEqual([]);
});
it("explicit reasoning provenance preserves the parent chunk stream", () =>
  expect(
    lint([
      start,
      text,
      {
        type: "REASONING_MESSAGE_START",
        messageId: "r",
        role: "reasoning",
        subagentRunId: "child",
      },
      { type: "REASONING_MESSAGE_CONTENT", messageId: "r", delta: "x" },
      { type: "REASONING_MESSAGE_END", messageId: "r" },
      { type: text.type, delta: "tail" },
      finish,
    ]).valid,
  ).toBe(true));
