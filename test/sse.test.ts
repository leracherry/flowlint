import { describe, expect, it } from "vitest";
import {
  lintEvents,
  parseTrace,
  TraceInputError,
  MAX_INPUT_BYTES,
} from "../src/index";
const start = { type: "RUN_STARTED", threadId: "t", runId: "r" };
const finish = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
const error = (text: string) => {
  try {
    parseTrace(text, { format: "sse" });
  } catch (e) {
    expect(e).toBeInstanceOf(TraceInputError);
    return e as TraceInputError;
  }
  throw new Error("Expected failure");
};
describe("SSE decoding", () => {
  it.each(["\n", "\r\n", "\r"])(
    "accepts line ending %j and preserves source positions",
    (newline) => {
      const trace = (frame(start) + frame(finish)).replaceAll("\n", newline);
      const records = parseTrace(trace);
      expect(records).toMatchObject([
        { event: start, eventIndex: 0, line: 1, column: 7 },
        { event: finish, eventIndex: 1, line: 3, column: 7 },
      ]);
      expect(lintEvents(records).diagnostics).toEqual([]);
    },
  );
  it("handles a BOM, comments, metadata and unknown fields", () => {
    const trace =
      "\uFEFF: hello\nevent: ignored\nid: 3\nretry: 10\nextra: ignored\n" +
      frame(start) +
      ": heartbeat\n\n" +
      frame(finish);
    expect(parseTrace(trace).map((r) => r.event)).toEqual([start, finish]);
  });
  it("joins multiple data fields with newlines", () => {
    const result = parseTrace(
      'data: {\ndata:   "type": "RUN_ERROR",\ndata:   "message": "example"\ndata: }\n\n',
    );
    expect(result[0]).toMatchObject({
      event: { type: "RUN_ERROR", message: "example" },
      line: 1,
      column: 7,
    });
  });
  it("maps multiline JSON errors back into data fields", () =>
    expect(error('data: {\ndata: "type": @\ndata: }\n\n')).toMatchObject({
      code: "PARSE_JSON",
      line: 2,
      column: 15,
    }));
  it("maps event start after empty data lines", () =>
    expect(
      parseTrace('data:\ndata: {"type":"RUN_ERROR","message":"x"}\n\n')[0],
    ).toMatchObject({ line: 2, column: 7 }));
  it.each([
    'data: {"type":"RUN_ERROR","message":"x"}',
    'data: {"type":"RUN_ERROR","message":"x"}\n',
  ])("reports unfinished data frames %j", (text) =>
    expect(error(text).code).toBe("PARSE_SSE_TRUNCATED"),
  );
  it("does not accept an undelimited terminal after valid events", () =>
    expect(
      error(frame(start) + "data: " + JSON.stringify(finish) + "\n").code,
    ).toBe("PARSE_SSE_TRUNCATED"));
  it.each(["[]", "null", "3", '"hello"'])(
    "rejects non-object payload %s",
    (data) => expect(error(`data: ${data}\n\n`).code).toBe("PARSE_SSE_EVENT"),
  );
  it.each(["[DONE]", "{} {}", '{"type":', ""])(
    "rejects invalid JSON payload %j",
    (data) => expect(error(`data: ${data}\n\n`).code).toBe("PARSE_JSON"),
  );
  it("ignores blocks without data and does not parse ignored field values", () =>
    expect(error("event: PRIVATE\nid: {bad}\n: ping\n\n").code).toBe(
      "PARSE_EMPTY",
    ));
  it("removes only one optional space after the colon", () =>
    expect(
      parseTrace('data:   {"type":"RUN_ERROR","message":"x"}\n\n')[0]?.column,
    ).toBe(9));
  it("accepts data without a space", () =>
    expect(
      parseTrace('data:{"type":"RUN_ERROR","message":"x"}\n\n')[0]?.column,
    ).toBe(6));
  it("supports explicit format with unknown leading fields", () =>
    expect(
      parseTrace("extension: x\n" + frame(start), { format: "sse" })[0]?.line,
    ).toBe(2));
  it("reports lifecycle errors at the original SSE line", () =>
    expect(
      lintEvents(
        parseTrace(
          frame(start) +
            frame({ type: "TEXT_MESSAGE_END", messageId: "missing" }) +
            frame(finish),
        ),
      ).diagnostics[0],
    ).toMatchObject({ ruleId: "FL002", line: 3, column: 7, eventIndex: 1 }));
  it("partial mode only changes lifecycle truncation severity", () =>
    expect(
      lintEvents(parseTrace(frame(start)), { allowPartial: true })
        .diagnostics[0]?.severity,
    ).toBe("warning"));
  it("enforces the raw input size limit", () =>
    expect(error(": " + "x".repeat(MAX_INPUT_BYTES)).code).toBe("PARSE_LIMIT"));
  it("does not expose data in syntax diagnostics", () =>
    expect(error('data: {"secret":"PRIVATE", bad}\n\n').message).not.toContain(
      "PRIVATE",
    ));
  it("keeps JSON and NDJSON detection unchanged", () => {
    expect(parseTrace(JSON.stringify([start, finish])).length).toBe(2);
    expect(
      parseTrace(JSON.stringify(start) + "\n" + JSON.stringify(finish)).length,
    ).toBe(2);
  });
});
