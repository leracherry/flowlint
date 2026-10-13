import { describe, expect, it } from "vitest";
import { EventSchemas } from "@ag-ui/core/schemas";
import { lintEvents, parseTrace } from "../src/index";
import { ChunkNormalizer } from "../src/normalize-chunks";
const start = { type: "RUN_STARTED", threadId: "t", runId: "r" };
const finish = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
const span = { type: "REASONING_START", messageId: "span" };
const spanEnd = { type: "REASONING_END", messageId: "span" };
const message = {
  type: "REASONING_MESSAGE_START",
  messageId: "m",
  role: "reasoning",
};
const content = {
  type: "REASONING_MESSAGE_CONTENT",
  messageId: "m",
  delta: "PRIVATE_REASONING",
};
const end = { type: "REASONING_MESSAGE_END", messageId: "m" };
const chunk = {
  type: "REASONING_MESSAGE_CHUNK",
  messageId: "m",
  delta: "PRIVATE_REASONING",
};
const step = { type: "STEP_STARTED", stepName: "work" };
const stepEnd = { type: "STEP_FINISHED", stepName: "work" };
const error = { type: "RUN_ERROR", message: "PRIVATE_ERROR" };
const lint = (events: unknown[], allowPartial = false) =>
  lintEvents(parseTrace(events.map((e) => JSON.stringify(e)).join("\n")), {
    allowPartial,
  });
const codes = (events: unknown[], partial = false) =>
  lint(events, partial).diagnostics.map((d) => d.ruleId);
const normalize = (events: unknown[]) => {
  const diagnostics: string[] = [];
  const n = new ChunkNormalizer((_source, rule) => diagnostics.push(rule));
  const output = parseTrace(JSON.stringify(events)).flatMap((r) =>
    n.push(EventSchemas.parse(r.event), r),
  );
  return { output, diagnostics };
};
const families = [
  {
    label: "span",
    open: span,
    close: spanEnd,
    duplicate: "REASONING_SPAN_START",
    missing: "REASONING_SPAN_END",
    unfinished: "REASONING_SPAN_OPEN",
  },
  {
    label: "reasoning message",
    open: message,
    close: end,
    duplicate: "REASONING_MESSAGE_START",
    missing: "REASONING_MESSAGE_MISSING",
    unfinished: "REASONING_MESSAGE_OPEN",
  },
  {
    label: "step",
    open: step,
    close: stepEnd,
    duplicate: "STEP_START",
    missing: "STEP_END",
    unfinished: "STEP_OPEN",
  },
];
describe.each(families)(
  "$label lifecycle",
  ({ open, close, duplicate, missing, unfinished }) => {
    it("accepts closure and reopening after closure", () =>
      expect(codes([start, open, close, open, close, finish])).toEqual([]));
    it("rejects duplicate starts without losing the opener", () =>
      expect(codes([start, open, open, close, finish])).toEqual([duplicate]));
    it("rejects orphaned and duplicate closes", () => {
      expect(codes([start, close, finish])).toEqual([missing]);
      expect(codes([start, open, close, close, finish])).toEqual([missing]);
    });
    it.each([
      undefined,
      { type: "cancelled" },
      { type: "interrupt", interrupts: [{ id: "i", reason: "approval" }] },
    ])("requires closure for outcome %j", (outcome) =>
      expect(
        codes([start, open, { ...finish, ...(outcome ? { outcome } : {}) }]),
      ).toEqual([unfinished]),
    );
    it("abandons open state at RUN_ERROR and resets for the next run", () =>
      expect(
        codes([
          start,
          open,
          error,
          { ...start, runId: "next" },
          open,
          close,
          { ...finish, runId: "next" },
        ]),
      ).toEqual([]));
    it("warns for missing excerpt openers but preserves observed contradictions", () => {
      const result = lint([close, close], true);
      expect(
        result.diagnostics
          .filter((d) => d.ruleId === missing)
          .map((d) => d.severity),
      ).toEqual(["warning", "error"]);
      expect(
        lint([open, open, close], true).diagnostics.find(
          (d) => d.ruleId === duplicate,
        )?.severity,
      ).toBe("error");
      expect(
        lint([open, finish], true).diagnostics.find(
          (d) => d.ruleId === unfinished,
        )?.severity,
      ).toBe("error");
    });
    it.each([false, true])("reports EOF truncation (partial=%s)", (partial) =>
      expect(lint([start, open], partial).diagnostics).toMatchObject([
        {
          ruleId: "FL012",
          severity: partial ? "warning" : "error",
          eventIndex: 1,
          line: 2,
        },
      ]),
    );
    it("uses subagent start as an excerpt boundary", () =>
      expect(
        lint(
          [
            { type: "SUBAGENT_STARTED", subagentRunId: "a", name: "child" },
            { ...close, subagentRunId: "a" },
            { type: "SUBAGENT_FINISHED", subagentRunId: "a" },
          ],
          true,
        ).diagnostics.find((d) => d.ruleId === missing)?.severity,
      ).toBe("error"));
    it("skips invalid schemas without closing state", () =>
      expect(
        codes([
          start,
          open,
          {
            ...close,
            ...("stepName" in close ? { stepName: 7 } : { messageId: 7 }),
          },
          finish,
        ]),
      ).toEqual(["SCHEMA_EVENT", unfinished]));
  },
);

describe("reasoning and steps together", () => {
  it("separates span, reasoning message, and text namespaces", () =>
    expect(
      codes([
        start,
        { ...span, messageId: "m" },
        message,
        { type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" },
        content,
        end,
        { ...spanEnd, messageId: "m" },
        { type: "TEXT_MESSAGE_END", messageId: "m" },
        finish,
      ]),
    ).toEqual([]));
  it("does not treat an open span as an open message", () =>
    expect(
      codes([
        start,
        { ...span, messageId: "m" },
        content,
        { ...spanEnd, messageId: "m" },
        finish,
      ]),
    ).toEqual(["REASONING_MESSAGE_MISSING"]));
  it("allows multiple messages per span and messages without spans", () =>
    expect(
      codes([
        start,
        span,
        message,
        content,
        end,
        message,
        end,
        spanEnd,
        message,
        end,
        finish,
      ]),
    ).toEqual([]));
  it("does not force spans and messages to nest", () =>
    expect(
      codes([start, span, message, spanEnd, content, end, finish]),
    ).toEqual([]));
  it("inherits span and message ownership on untagged closes", () =>
    expect(
      codes([
        start,
        { ...span, subagentRunId: "a" },
        { ...message, subagentRunId: "a" },
        content,
        end,
        spanEnd,
        finish,
      ]),
    ).toEqual([]));
  it("rejects span attribution changes without closing it", () =>
    expect(
      codes([
        start,
        { ...span, subagentRunId: "a" },
        { ...spanEnd, subagentRunId: "b" },
        spanEnd,
        finish,
      ]),
    ).toEqual(["ATTRIBUTION"]));
  it("permits overlapping steps and same-named steps per owner", () =>
    expect(
      codes([
        start,
        step,
        { ...step, subagentRunId: "" },
        { ...step, subagentRunId: "a" },
        { ...step, stepName: "other" },
        { ...stepEnd, subagentRunId: "a" },
        stepEnd,
        { ...stepEnd, subagentRunId: "" },
        { ...stepEnd, stepName: "other" },
        finish,
      ]),
    ).toEqual([]));
  it("a step is not a container for messages or spans", () =>
    expect(
      codes([
        start,
        step,
        span,
        message,
        stepEnd,
        content,
        end,
        spanEnd,
        finish,
      ]),
    ).toEqual([]));
  it("wrong step attribution preserves the correct owner's open state", () =>
    expect(
      codes([
        start,
        { ...step, subagentRunId: "a" },
        stepEnd,
        { ...stepEnd, subagentRunId: "a" },
        finish,
      ]),
    ).toEqual(["ATTRIBUTION"]));
  it("subagent terminals do not silently close explicit reasoning or steps", () =>
    expect(
      codes([
        start,
        { type: "SUBAGENT_STARTED", subagentRunId: "a", name: "child" },
        { ...span, subagentRunId: "a" },
        { ...message, subagentRunId: "a" },
        { ...step, subagentRunId: "a" },
        { type: "SUBAGENT_FINISHED", subagentRunId: "a" },
        finish,
      ]),
    ).toEqual(["REASONING_MESSAGE_OPEN", "REASONING_SPAN_OPEN", "STEP_OPEN"]));
  it("encrypted values are opaque standalone events", () =>
    expect(
      codes([
        start,
        span,
        message,
        {
          type: "REASONING_ENCRYPTED_VALUE",
          subtype: "message",
          entityId: "m",
          encryptedValue: "not-json SECRET",
        },
        content,
        end,
        spanEnd,
        finish,
      ]),
    ).toEqual([]));
  it("keeps reasoning bodies out of diagnostics", () => {
    const result = lint([start, content, finish]);
    expect(result.diagnostics[0]).toMatchObject({
      ruleId: "REASONING_MESSAGE_MISSING",
      line: 2,
      column: 1,
      eventIndex: 1,
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_REASONING");
  });
});

describe("reasoning chunks", () => {
  it("expands chunks into valid reasoning triads", () => {
    const { output, diagnostics } = normalize([
      start,
      chunk,
      { type: chunk.type, delta: "tail" },
      finish,
    ]);
    expect(diagnostics).toEqual([]);
    expect(output.map((e) => e.type)).toEqual([
      "RUN_STARTED",
      "REASONING_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_END",
      "RUN_FINISHED",
    ]);
    expect(output.every((e) => EventSchemas.safeParse(e).success)).toBe(true);
    expect(lint([start, chunk, finish]).diagnostics).toEqual([]);
  });
  it("requires an opening message ID", () =>
    expect(codes([start, { type: chunk.type, delta: "x" }, finish])).toEqual([
      "FL010",
    ]));
  it("supports metadata-only and empty chunks", () =>
    expect(
      codes([
        start,
        { type: chunk.type, messageId: "m" },
        { type: chunk.type, metadata: { progress: true } },
        { type: chunk.type, delta: "" },
        finish,
      ]),
    ).toEqual([]));
  it("switches IDs and families in a single lane", () =>
    expect(
      codes([
        start,
        chunk,
        { ...chunk, messageId: "next" },
        { type: "TEXT_MESSAGE_CHUNK", messageId: "answer", delta: "x" },
        {
          type: "TOOL_CALL_CHUNK",
          toolCallId: "t",
          toolCallName: "f",
          delta: "{}",
        },
        chunk,
        finish,
      ]),
    ).toEqual([]));
  it.each([message, content, end])(
    "rejects chunk/explicit mixing %j",
    (event) => expect(codes([start, chunk, event, error])).toContain("FL011"),
  );
  it("rejects explicit/chunk mixing without losing the explicit message", () =>
    expect(codes([start, message, chunk, end, finish])).toEqual(["FL011"]));
  it("rejects conflicting tags", () =>
    expect(
      codes([
        start,
        { ...chunk, subagentRunId: "a" },
        { type: chunk.type, messageId: "m", subagentRunId: "b", delta: "x" },
        finish,
      ]),
    ).toEqual(["ATTRIBUTION"]));
  it("resolves identifier-only and sole-child continuations", () =>
    expect(
      codes([
        start,
        { ...chunk, subagentRunId: "a" },
        { type: chunk.type, messageId: "m", delta: "x" },
        { type: chunk.type, delta: "y" },
        finish,
      ]),
    ).toEqual([]));
  it("rejects ambiguous continuations without closing either lane", () =>
    expect(
      codes([
        start,
        { ...chunk, subagentRunId: "a" },
        { ...chunk, messageId: "b", subagentRunId: "b" },
        { type: chunk.type, delta: "x" },
        finish,
      ]),
    ).toEqual(["FL011"]));
  it("prefers parent continuation over concurrent children", () => {
    const { output } = normalize([
      start,
      chunk,
      { ...chunk, messageId: "child", subagentRunId: "a" },
      { type: chunk.type, delta: "tail" },
      finish,
    ]);
    expect(
      output.find(
        (e) => e.type === "REASONING_MESSAGE_CONTENT" && e.delta === "tail",
      ),
    ).toMatchObject({ messageId: "m" });
  });
  it("span end closes only the span owner's chunk lane", () =>
    expect(
      codes([
        start,
        { ...span, subagentRunId: "a" },
        { ...chunk, subagentRunId: "a" },
        { ...chunk, messageId: "b", subagentRunId: "b" },
        spanEnd,
        { type: chunk.type, subagentRunId: "b", delta: "tail" },
        finish,
      ]),
    ).toEqual([]));
  it("subagent terminals close only their reasoning chunk lane", () =>
    expect(
      codes([
        start,
        { type: "SUBAGENT_STARTED", subagentRunId: "a", name: "worker" },
        { ...chunk, subagentRunId: "a" },
        { ...chunk, messageId: "b", subagentRunId: "b" },
        { type: "SUBAGENT_FINISHED", subagentRunId: "a" },
        { type: chunk.type, subagentRunId: "b", delta: "tail" },
        finish,
      ]),
    ).toEqual([]));
  it("snapshots close reasoning chunks and preserve explicit spans", () =>
    expect(
      codes([
        start,
        span,
        chunk,
        { type: "MESSAGES_SNAPSHOT", messages: [] },
        finish,
      ]),
    ).toEqual(["REASONING_SPAN_OPEN"]));
  it("standalone encrypted values leave reasoning chunks open", () =>
    expect(
      codes([
        start,
        chunk,
        {
          type: "REASONING_ENCRYPTED_VALUE",
          subtype: "message",
          entityId: "m",
          encryptedValue: "opaque",
        },
        { type: chunk.type, delta: "tail" },
        finish,
      ]),
    ).toEqual([]));
  it("EOF does not synthesize reasoning closure", () =>
    expect(codes([start, chunk])).toEqual(["FL012"]));
  it("partial openers warn until an observed boundary", () => {
    expect(
      lint([{ type: chunk.type, delta: "x" }], true).diagnostics.find(
        (d) => d.ruleId === "FL010",
      )?.severity,
    ).toBe("warning");
    expect(
      lint(
        [span, { type: chunk.type, delta: "x" }, spanEnd],
        true,
      ).diagnostics.find((d) => d.ruleId === "FL010")?.severity,
    ).toBe("error");
  });
  it("does not lose state at a rejected nested run start", () =>
    expect(
      codes([
        start,
        chunk,
        { ...start, runId: "bad" },
        { type: chunk.type, delta: "tail" },
        finish,
      ]),
    ).toEqual(["FL006"]));
});
it("partial same-named steps may have an unseen opener for a different owner", () => {
  const result = lint(
    [step, { ...stepEnd, subagentRunId: "a" }, stepEnd],
    true,
  );
  expect(result.valid).toBe(true);
  expect(
    result.diagnostics.find((d) => d.ruleId === "STEP_END")?.severity,
  ).toBe("warning");
  expect(result.diagnostics.some((d) => d.ruleId === "ATTRIBUTION")).toBe(
    false,
  );
});
it("an observed child boundary makes a missing step opener an error in an excerpt", () => {
  const result = lint(
    [
      step,
      { type: "SUBAGENT_STARTED", subagentRunId: "a", name: "child" },
      { ...stepEnd, subagentRunId: "a" },
      stepEnd,
    ],
    true,
  );
  expect(
    result.diagnostics.find((d) => d.ruleId === "ATTRIBUTION")?.severity,
  ).toBe("error");
});
