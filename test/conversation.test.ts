import { expect, it } from "vitest";
import { lintEvents, parseTrace } from "../src/index";
const start = { type: "RUN_STARTED", threadId: "t", runId: "r" };
const finish = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
const text = (extra = {}) => ({
  type: "TEXT_MESSAGE_START",
  messageId: "m",
  ...extra,
});
const end = { type: "TEXT_MESSAGE_END", messageId: "m" };
const tool = (extra = {}) => ({
  type: "TOOL_CALL_START",
  toolCallId: "c",
  toolCallName: "search",
  ...extra,
});
const toolEnd = { type: "TOOL_CALL_END", toolCallId: "c" };
const encrypted = (extra = {}) => ({
  type: "REASONING_ENCRYPTED_VALUE",
  subtype: "message",
  entityId: "m",
  encryptedValue: "OPAQUE_SECRET",
  ...extra,
});
const snapshot = (messages: unknown[]) => ({
  type: "MESSAGES_SNAPSHOT",
  messages,
});
const message = (extra = {}) => ({
  id: "m",
  role: "assistant",
  content: "",
  ...extra,
});
const next = (messages?: unknown[], threadId = "t") => ({
  ...start,
  threadId,
  runId: "next",
  ...(messages === undefined
    ? {}
    : {
        input: {
          threadId,
          runId: "next",
          messages,
          tools: [],
          context: [],
          forwardedProps: {},
        },
      }),
});
const nextEnd = { ...finish, runId: "next" };
const lint = (events: unknown[], allowPartial = false) =>
  lintEvents(parseTrace(events.map((e) => JSON.stringify(e)).join("\n")), {
    allowPartial,
  });
const run = (...events: unknown[]) =>
  lint([start, ...events, finish]).diagnostics;
it("accepts matching explicit and chunk reopenings", () =>
  expect(
    run(text(), end, text({ role: "assistant" }), end, {
      type: "TEXT_MESSAGE_CHUNK",
      messageId: "m",
    }),
  ).toEqual([]));
it.each([{ role: "user" }, { name: "new" }])(
  "rejects changed message attributes %j",
  (extra) =>
    expect(run(text(), end, text(extra), end)).toMatchObject([
      { ruleId: "ITEM_REOPEN", severity: "error", line: 4 },
    ]),
);
it("treats omitted name as a value and retains original attributes", () =>
  expect(
    run(
      text({ name: "speaker" }),
      end,
      text(),
      end,
      text({ name: "speaker" }),
      end,
    ),
  ).toMatchObject([{ ruleId: "ITEM_REOPEN" }]));
it.each([{ toolCallName: "other" }, { parentMessageId: "p" }])(
  "rejects changed tool attributes %j",
  (extra) =>
    expect(run(tool(), toolEnd, tool(extra), toolEnd)).toMatchObject([
      { ruleId: "ITEM_REOPEN" },
    ]),
);
it("detects reopening from chunks", () =>
  expect(
    run(tool(), toolEnd, {
      type: "TOOL_CALL_CHUNK",
      toolCallId: "c",
      toolCallName: "other",
    }),
  ).toMatchObject([{ ruleId: "ITEM_REOPEN" }]));
it("allows matching tool reopenings and omission of inherited owner", () =>
  expect(
    run(tool({ subagentRunId: "child" }), toolEnd, tool(), toolEnd),
  ).toEqual([]));
it("checks attributes and ownership across runs", () =>
  expect(
    lint([
      start,
      text({ name: "speaker", subagentRunId: "child" }),
      end,
      finish,
      next(),
      text({ name: "other" }),
      end,
      nextEnd,
    ]).diagnostics,
  ).toMatchObject([{ ruleId: "ITEM_REOPEN" }]));
it("isolates conversations by thread", () =>
  expect(
    lint([
      start,
      text(),
      end,
      finish,
      next(undefined, "other"),
      text({ role: "user" }),
      end,
      { ...nextEnd, threadId: "other" },
    ]).diagnostics,
  ).toEqual([]));
it("snapshots authoritatively replace opening attributes", () =>
  expect(
    run(
      text(),
      end,
      snapshot([message({ role: "user", name: "new" })]),
      text({ role: "user", name: "new" }),
      end,
    ),
  ).toEqual([]));
it("loads tool attributes from input history", () =>
  expect(
    lint([
      next([
        message({
          toolCalls: [
            {
              id: "c",
              type: "function",
              function: { name: "search", arguments: "" },
            },
          ],
        }),
      ]),
      tool({ parentMessageId: "m", toolCallName: "changed" }),
      toolEnd,
      nextEnd,
    ]).diagnostics,
  ).toMatchObject([{ ruleId: "ITEM_REOPEN" }]));
it("keeps duplicate-start diagnostics separate", () =>
  expect(run(text(), text({ name: "changed" }), end)).toMatchObject([
    { ruleId: "FL008" },
  ]));
it("observed reopening contradictions remain errors in excerpts", () =>
  expect(
    lint([text(), end, text({ role: "user" }), end], true).diagnostics.filter(
      (d) => d.ruleId === "ITEM_REOPEN",
    ),
  ).toMatchObject([{ severity: "error" }]));
it.each([{}, { subtype: "tool-call" }])(
  "warns for missing encrypted target %j",
  (extra) =>
    expect(run(encrypted(extra))).toMatchObject([
      { ruleId: "ENCRYPTED_TARGET", severity: "warning" },
    ]),
);
it("does not mistake a reasoning span for a message", () =>
  expect(
    run({ type: "REASONING_START", messageId: "m" }, encrypted(), {
      type: "REASONING_END",
      messageId: "m",
    }),
  ).toMatchObject([{ ruleId: "ENCRYPTED_TARGET" }]));
it("does not store artifacts on activities", () =>
  expect(
    run(
      {
        type: "ACTIVITY_SNAPSHOT",
        messageId: "m",
        activityType: "progress",
        content: {},
      },
      encrypted(),
    ),
  ).toMatchObject([{ ruleId: "ENCRYPTED_TARGET" }]));
it("supports closed and open messages, reasoning chunks and tool results", () =>
  expect(
    run(
      text(),
      encrypted(),
      end,
      encrypted(),
      { type: "REASONING_MESSAGE_CHUNK", messageId: "reason" },
      encrypted({ entityId: "reason" }),
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "c",
        messageId: "result",
        content: "",
      },
      encrypted({ entityId: "result" }),
    ),
  ).toEqual([]));
it("stores tool artifacts in a separate namespace", () =>
  expect(
    run(
      tool(),
      encrypted({ subtype: "tool-call", entityId: "c" }),
      toolEnd,
      encrypted({ entityId: "c" }),
    ),
  ).toMatchObject([{ ruleId: "ENCRYPTED_TARGET" }]));
it("accepts byte-for-byte preservation and latest-value replacement", () =>
  expect(
    lint([
      start,
      text(),
      end,
      encrypted(),
      encrypted({ encryptedValue: "latest" }),
      finish,
      next([message({ encryptedValue: "latest" })]),
      nextEnd,
    ]).diagnostics,
  ).toEqual([]));
it.each(
  [[], [message()], [message({ encryptedValue: "changed" })]].map(
    (messages) => ({ messages }),
  ),
)("warns for omitted or changed artifacts in input %j", ({ messages }) =>
  expect(
    lint([start, text(), end, encrypted(), finish, next(messages), nextEnd])
      .diagnostics,
  ).toMatchObject([{ ruleId: "ENCRYPTED_PRESERVATION", severity: "warning" }]),
);
it("checks tools nested in input messages", () =>
  expect(
    lint([
      start,
      text(),
      end,
      tool({ parentMessageId: "m" }),
      toolEnd,
      encrypted({ subtype: "tool-call", entityId: "c" }),
      finish,
      next([
        message({
          toolCalls: [
            {
              id: "c",
              type: "function",
              function: { name: "search", arguments: "" },
              encryptedValue: "OPAQUE_SECRET",
            },
          ],
        }),
      ]),
      nextEnd,
    ]).diagnostics,
  ).toEqual([]));
it("warns for lost tool artifacts", () =>
  expect(
    lint([
      start,
      tool(),
      toolEnd,
      encrypted({ subtype: "tool-call", entityId: "c" }),
      finish,
      next([]),
      nextEnd,
    ]).diagnostics,
  ).toMatchObject([{ ruleId: "ENCRYPTED_PRESERVATION" }]));
it("does not infer loss when input was not captured", () =>
  expect(
    lint([start, text(), end, encrypted(), finish, next(), nextEnd])
      .diagnostics,
  ).toEqual([]));
it("snapshot omission withdraws the producer artifact", () =>
  expect(
    lint([
      start,
      text(),
      end,
      encrypted(),
      snapshot([message()]),
      finish,
      next([message()]),
      nextEnd,
    ]).diagnostics,
  ).toEqual([]));
it("snapshot deletion removes the target and its tools", () =>
  expect(
    run(
      text(),
      end,
      tool({ parentMessageId: "m" }),
      toolEnd,
      snapshot([]),
      encrypted(),
      encrypted({ subtype: "tool-call", entityId: "c" }),
    ),
  ).toMatchObject([
    { ruleId: "ENCRYPTED_TARGET" },
    { ruleId: "ENCRYPTED_TARGET" },
  ]));
it("reasoning survives snapshots without reasoning but an explicit set removes it", () =>
  expect(
    run(
      { type: "REASONING_MESSAGE_CHUNK", messageId: "m" },
      snapshot([]),
      encrypted(),
      snapshot([{ id: "other", role: "reasoning", content: "" }]),
      encrypted(),
    ),
  ).toMatchObject([{ ruleId: "ENCRYPTED_TARGET" }]));
it("preserves artifacts across RUN_ERROR", () =>
  expect(
    lint([
      start,
      text(),
      encrypted(),
      { type: "RUN_ERROR", message: "failed" },
      next([]),
      nextEnd,
    ]).diagnostics,
  ).toMatchObject([{ ruleId: "ENCRYPTED_PRESERVATION" }]));
it("warns and skips unknown string subtypes but rejects malformed events", () =>
  expect(
    run(
      encrypted({ subtype: "future" }),
      encrypted({ subtype: 2 }),
      encrypted({ subtype: "future", encryptedValue: 2 }),
    ),
  ).toMatchObject([
    { ruleId: "ENCRYPTED_SUBTYPE", severity: "warning" },
    { ruleId: "SCHEMA_EVENT" },
    { ruleId: "SCHEMA_EVENT" },
  ]));
it("never emits artifacts, conflicting values, or mutates input", () => {
  const events = [
    start,
    text({ name: "PRIVATE_NAME" }),
    end,
    encrypted(),
    text({ name: "OTHER_PRIVATE" }),
    end,
    finish,
    next([message()]),
    nextEnd,
  ];
  const records = parseTrace(JSON.stringify(events));
  const before = JSON.stringify(records);
  const result = lintEvents(records);
  expect(JSON.stringify(result)).not.toMatch(
    /OPAQUE_SECRET|PRIVATE_NAME|OTHER_PRIVATE/,
  );
  expect(JSON.stringify(records)).toBe(before);
});
it("compares opaque Unicode strings without normalizing them", () =>
  expect(
    lint([
      start,
      text(),
      end,
      encrypted({ encryptedValue: "\ud800" }),
      finish,
      next([message({ encryptedValue: "\ufffd" })]),
      nextEnd,
    ]).diagnostics,
  ).toMatchObject([{ ruleId: "ENCRYPTED_PRESERVATION" }]));
it("snapshot replacement withdraws nested tool artifacts", () =>
  expect(
    lint([
      start,
      text(),
      end,
      tool({ parentMessageId: "m" }),
      toolEnd,
      encrypted({ subtype: "tool-call", entityId: "c" }),
      snapshot([message()]),
      finish,
      next([message()]),
      nextEnd,
    ]).diagnostics,
  ).toEqual([]));
it("ignores rejected run boundaries and post-terminal encrypted writes", () =>
  expect(
    lint([
      start,
      text(),
      end,
      encrypted(),
      next([]),
      finish,
      encrypted({ encryptedValue: "changed" }),
      next([message({ encryptedValue: "OPAQUE_SECRET" })]),
      nextEnd,
    ]).diagnostics,
  ).toMatchObject([{ ruleId: "FL006" }, { ruleId: "RUN_TRANSITION" }]));
it("complete history snapshots remove tools without explicit parents", () =>
  expect(
    run(
      tool(),
      toolEnd,
      snapshot([]),
      encrypted({ subtype: "tool-call", entityId: "c" }),
    ),
  ).toMatchObject([{ ruleId: "ENCRYPTED_TARGET" }]));
it("activity creation replaces a same-ID non-activity target", () =>
  expect(
    run(
      text(),
      end,
      {
        type: "ACTIVITY_SNAPSHOT",
        messageId: "m",
        activityType: "progress",
        replace: false,
        content: {},
      },
      encrypted(),
    ),
  ).toMatchObject([{ ruleId: "ENCRYPTED_TARGET" }]));
