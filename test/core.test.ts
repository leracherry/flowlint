import { describe, expect, it } from "vitest";
import {
  lintEvents,
  parseTrace,
  TraceInputError,
  MAX_INPUT_BYTES,
} from "../src/index";
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
const lint = (events: unknown[], allowPartial = false) =>
  lintEvents(parseTrace(JSON.stringify(events)), { allowPartial });
describe("parsing", () => {
  it("preserves NDJSON locations and blank lines", () => {
    const records = parseTrace(
      '\n  {"type":"RAW","event":{}}\n\n{"type":"RAW","event":{}}',
    );
    expect(
      records.map(({ line, column, eventIndex }) => [line, column, eventIndex]),
    ).toEqual([
      [2, 3, 0],
      [4, 1, 1],
    ]);
  });
  it("preserves array item locations", () => {
    expect(
      parseTrace("[\n  {},\n  {}\n]").map((r) => [r.line, r.column]),
    ).toEqual([
      [2, 3],
      [3, 3],
    ]);
  });
  it.each(["", " \n", "[]"])("rejects empty trace %j", (text) =>
    expect(() => parseTrace(text)).toThrow(TraceInputError),
  );
  it.each([
    '{"secret":"PRIVATE_BODY",}',
    "[{},]",
    "[/* secret */{}]",
    "{bad}",
    "{} {}",
  ])("rejects malformed JSON without exposing bodies", (text) => {
    try {
      parseTrace(text);
      throw new Error("Expected parse failure");
    } catch (e) {
      expect(e).toBeInstanceOf(TraceInputError);
      expect((e as Error).message).not.toContain("PRIVATE_BODY");
    }
  });
  it("reports malformed line location", () => {
    try {
      parseTrace("{}\n{bad}");
    } catch (e) {
      expect((e as TraceInputError).line).toBe(2);
    }
  });
  it("enforces format overrides", () =>
    expect(() => parseTrace("{}", { format: "json" })).toThrow("array"));
  it("bounds input size", () =>
    expect(() => parseTrace(" ".repeat(MAX_INPUT_BYTES + 1))).toThrow("limit"));
});
describe("schema and initial lifecycle slice", () => {
  it("accepts a complete text trace", () =>
    expect(lint([start, message, content, end, finish]).valid).toBe(true));
  it("reports FL002 at its source", () => {
    const result = lint([start, content, finish]);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      ruleId: "FL002",
      eventIndex: 1,
      line: 1,
      severity: "error",
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_BODY");
  });
  it("detects content after a close", () =>
    expect(
      lint([start, message, end, content, finish]).diagnostics[0]?.ruleId,
    ).toBe("FL002"));
  it("keeps message IDs independent", () =>
    expect(
      lint([start, { ...message, messageId: "other" }, content]).valid,
    ).toBe(false));
  it("resets state across runs", () =>
    expect(
      lint([start, message, finish, { ...start, runId: "next" }, content])
        .valid,
    ).toBe(false));
  it("allows tool and text interleaving without requiring results", () => {
    expect(
      lint([
        start,
        message,
        { type: "TOOL_CALL_START", toolCallId: "t", toolCallName: "search" },
        content,
        { type: "TOOL_CALL_ARGS", toolCallId: "t", delta: "not JSON" },
        { type: "TOOL_CALL_END", toolCallId: "t" },
        end,
        finish,
      ]).valid,
    ).toBe(true);
  });
  it("accepts run error and late errors", () =>
    expect(
      lint([
        start,
        message,
        { type: "RUN_ERROR", message: "Failed" },
        { ...start, runId: "next" },
        { ...finish, runId: "next" },
        { type: "RUN_ERROR", message: "Late" },
      ]).valid,
    ).toBe(true));
  it("downgrades missing excerpt openers", () =>
    expect(
      lint([content], true).diagnostics.find((d) => d.ruleId === "FL002")
        ?.severity,
    ).toBe("warning"));
  it("retains observed contradictions in partial mode", () =>
    expect(lint([start, content], true).diagnostics[0]?.severity).toBe(
      "error",
    ));
  it.each([null, 3, {}, { type: "TEXT_MESSAGE_CONTENT", messageId: "m" }])(
    "reports schema failure %j",
    (event) =>
      expect(lint([event]).diagnostics[0]?.ruleId).toBe("SCHEMA_EVENT"),
  );
  it("skips schema-invalid starts safely", () =>
    expect(
      lint([{ type: "TEXT_MESSAGE_START" }, content]).diagnostics.map(
        (d) => d.ruleId,
      ),
    ).toEqual(["SCHEMA_EVENT", "FL001", "FL002", "FL012"]));
  it("rejects mixing chunks and explicit content", () => {
    const result = lint([
      start,
      { type: "TEXT_MESSAGE_CHUNK", messageId: "m", delta: "Hello" },
      content,
      finish,
    ]);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.ruleId)).toEqual(["FL002", "FL011"]);
  });
  it("bounds diagnostics with an explicit error", () => {
    const result = lint(Array.from({ length: 1002 }, () => null));
    expect(result.diagnostics).toHaveLength(1001);
    expect(result.diagnostics.at(-1)?.ruleId).toBe("LIMIT_DIAGNOSTICS");
  });
});
