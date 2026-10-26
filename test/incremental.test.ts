import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import {
  createLintSession,
  lintEvents,
  lintTraceStream,
  parseTrace,
  parseTraceStream,
  TraceInputError,
  MAX_INPUT_BYTES,
} from "../src/index";
const start = { type: "RUN_STARTED", threadId: "t", runId: "r" };
const end = { type: "RUN_FINISHED", threadId: "t", runId: "r" };
const records = (events: unknown[]) => parseTrace(JSON.stringify(events));
async function* chunks(source: Buffer, sizes: number[] = [1]) {
  let offset = 0,
    index = 0;
  while (offset < source.length) {
    const next = offset + sizes[index++ % sizes.length]!;
    yield source.subarray(offset, next);
    offset = next;
  }
}
function partitionSizes(seed: number): number[] {
  return Array.from({ length: 32 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return 1 + (seed % 127);
  });
}
async function collect(
  source: AsyncIterable<Uint8Array>,
  format: "ndjson" | "sse",
) {
  const result = [];
  for await (const record of parseTraceStream(source, { format }))
    result.push(record);
  return result;
}
it("defers EOF checks, finalizes once, and prevents pushes after finish", () => {
  const session = createLintSession();
  session.push(records([start])[0]!);
  expect(session.snapshot().diagnostics).toEqual([]);
  expect(session.status).toBe("active");
  const result = session.finish();
  expect(result.diagnostics.map((d) => d.ruleId)).toEqual(["FL012"]);
  expect(session.finish()).toEqual(result);
  expect(session.status).toBe("finished");
  expect(() => session.push(records([end])[0]!)).toThrow();
  expect(session.cancel()).toEqual(result);
  expect(session.status).toBe("finished");
});
it("cancels without manufacturing EOF findings or claiming a finished status", () => {
  const session = createLintSession();
  session.push(records([start])[0]!);
  expect(session.cancel().diagnostics).toEqual([]);
  expect(session.status).toBe("cancelled");
  expect(session.finish()).toEqual(session.snapshot());
  expect(() => session.push(records([end])[0]!)).toThrow();
});
it("isolates options and snapshots from caller mutation", () => {
  const options = { allowPartial: false };
  const session = createLintSession(options);
  options.allowPartial = true;
  for (const record of records([
    { type: "TEXT_MESSAGE_START", messageId: "m" },
    { type: "TEXT_MESSAGE_END", messageId: "m" },
    { type: "TEXT_MESSAGE_START", messageId: "m", role: "user" },
  ]))
    session.push(record);
  const snapshot = session.snapshot();
  snapshot.diagnostics[0]!.message = "modified";
  snapshot.diagnostics.find((d) => d.related)!.related![0]!.line = 999;
  expect(
    session
      .snapshot()
      .diagnostics.some(
        (d) => d.message === "modified" || d.related?.[0]?.line === 999,
      ),
  ).toBe(false);
  expect(
    session.finish().diagnostics.find((d) => d.ruleId === "FL012")!.severity,
  ).toBe("error");
});
it("bounds new sessions without adding a limit to the existing batch API", () => {
  const session = createLintSession({ maxEvents: 1 });
  const input = records([start, end]);
  session.push(input[0]!);
  expect(() => session.push(input[1]!)).toThrow(TraceInputError);
  expect(session.status).toBe("cancelled");
  expect(session.snapshot().checkedEvents).toBe(1);
  expect(lintEvents(input).valid).toBe(true);
  for (const maxEvents of [0, -1, NaN, 1.2])
    expect(() => createLintSession({ maxEvents })).toThrow(RangeError);
});
it("preserves diagnostic caps and last-valid EOF locations", () => {
  const input = records([
    start,
    ...Array.from({ length: 1200 }, () => ({
      type: "TEXT_MESSAGE_END",
      messageId: "missing",
    })),
    { type: "unknown" },
  ]);
  const session = createLintSession();
  for (const record of input) session.push(record);
  expect(session.finish()).toEqual(lintEvents(input));
  expect(session.finish().diagnostics.at(-1)!.ruleId).toBe("LIMIT_DIAGNOSTICS");
});
for (const root of [
  "examples",
  "test/fixtures/valid",
  "test/fixtures/invalid",
  "test/fixtures/producers",
]) {
  for (const file of readdirSync(root).filter(
    (f) => /\.(ndjson|sse|json)$/.test(f) && f !== "manifest.json",
  )) {
    it(`agrees with batch on ${root}/${file} and seeded byte partitions`, async () => {
      const original = parseTrace(readFileSync(`${root}/${file}`, "utf8"));
      for (const allowPartial of [false, true]) {
        const session = createLintSession({ allowPartial });
        for (const record of original) session.push(record);
        expect(session.finish()).toEqual(
          lintEvents(original, { allowPartial }),
        );
      }
      // The original record positions are tested above. Re-encode this corpus
      // for each streaming transport and compare with that encoding's batch parse.
      for (const format of ["ndjson", "sse"] as const) {
        const source = original
          .map((r) =>
            format === "sse"
              ? `data: ${JSON.stringify(r.event)}\r\n\r\n`
              : JSON.stringify(r.event) + "\r\n",
          )
          .join("");
        const streamed = await collect(
          chunks(Buffer.from(source), partitionSizes(source.length)),
          format,
        );
        expect(streamed).toEqual(parseTrace(source, { format }));
      }
    });
  }
}
const shortCases = [
  {
    format: "ndjson" as const,
    source:
      '  {"type":"RAW","event":"🌱"}\r\n\n {"type":"RUN_ERROR","message":"x"}',
  },
  {
    format: "sse" as const,
    source:
      '\ufeff: comment\r\n\r\ndata: {"type":"RAW",\r\ndata: "event":"🌱"}\r\n\r\ndata: {"type":"RUN_ERROR","message":"x"}\n\n',
  },
  {
    format: "sse" as const,
    source:
      ':first\n\n\ufeffdata: {"type":"ignored"}\n\ndata: {"type":"RUN_ERROR","message":"x"}\r\r',
  },
];
for (const { format, source } of shortCases)
  it(`preserves every byte split for ${format}: ${source.slice(0, 15)}`, async () => {
    const bytes = Buffer.from(source);
    const expected = parseTrace(source, { format });
    for (let split = 0; split <= bytes.length; split++) {
      async function* input() {
        yield bytes.subarray(0, split);
        yield bytes.subarray(split);
      }
      expect(await collect(input(), format)).toEqual(expected);
    }
    expect(await collect(chunks(bytes), format)).toEqual(expected);
  });
function errorDetails(error: unknown) {
  if (!(error instanceof TraceInputError)) throw error;
  return {
    code: error.code,
    line: error.line,
    column: error.column,
    message: error.message,
  };
}
it.each([
  ["ndjson", '\n {"type":}\n'],
  ["ndjson", '\ufeff {"type":"RUN_ERROR","message":"x"}'],
  ["sse", ':comment\n\ndata: {"type":}\n\n'],
  ["sse", 'data: {"type":"RUN_ERROR","message":"x"}\n'],
  ["sse", "data: []\n\n"],
  ["sse", ": comment\n\n"],
  ["ndjson", "  \n\r\n"],
  ["ndjson", '{"x":' + "[".repeat(257) + "]".repeat(257) + "}"],
])("preserves parser error locations for %s", async (format, source) => {
  let expected;
  try {
    parseTrace(source, { format: format as "ndjson" | "sse" });
  } catch (error) {
    expected = errorDetails(error);
  }
  expect(expected).toBeDefined();
  try {
    await collect(chunks(Buffer.from(source)), format as "ndjson" | "sse");
    throw new Error("Expected parser failure");
  } catch (error) {
    expect(errorDetails(error)).toEqual(expected);
  }
});
it("enforces byte and physical-line limits incrementally", async () => {
  await expect(
    collect(chunks(Buffer.alloc(MAX_INPUT_BYTES + 1, 32), [65536]), "ndjson"),
  ).rejects.toMatchObject({ code: "PARSE_LIMIT" });
  await expect(
    collect(chunks(Buffer.from(":c\n" + "\n".repeat(99999)), [333]), "sse"),
  ).rejects.toMatchObject({ code: "PARSE_LINES", line: 100001, column: 1 });
});
it("rejects unsupported formats and releases its source on early return", async () => {
  await expect(
    collect(chunks(Buffer.from("[]")), "json" as "ndjson"),
  ).rejects.toMatchObject({ code: "PARSE_FORMAT" });
  let closed = false;
  async function* input() {
    try {
      while (true) yield Buffer.from('{"type":"RAW","event":{}}\n');
    } finally {
      closed = true;
    }
  }
  for await (const record of parseTraceStream(input())) {
    expect(record.eventIndex).toBe(0);
    break;
  }
  expect(closed).toBe(true);
});

it("finalizes streaming lint only after EOF and preserves source failures", async () => {
  const source = Buffer.from(JSON.stringify(start) + "\n");
  expect(await lintTraceStream(chunks(source))).toEqual(
    lintEvents(parseTrace(source.toString())),
  );
  const error = new Error("source disconnected");
  let closed = false;
  async function* input() {
    try {
      yield source;
      throw error;
    } finally {
      closed = true;
    }
  }
  await expect(lintTraceStream(input())).rejects.toBe(error);
  expect(closed).toBe(true);
});
it("closes the streaming source when a session limit is reached", async () => {
  let closed = false;
  async function* input() {
    try {
      while (true) yield Buffer.from('{"type":"RAW","event":{}}\n');
    } finally {
      closed = true;
    }
  }
  await expect(
    lintTraceStream(input(), { maxEvents: 1 }),
  ).rejects.toMatchObject({ code: "LIMIT_SESSION" });
  expect(closed).toBe(true);
});

it("accepts an SSE frame at the global byte limit after an empty frame", async () => {
  const prefix = '\ndata: {"type":"RAW","event":"';
  const suffix = '"}\n\n';
  const source =
    prefix +
    "x".repeat(MAX_INPUT_BYTES - Buffer.byteLength(prefix + suffix)) +
    suffix;
  const bytes = Buffer.from(source);
  expect(bytes.length).toBe(MAX_INPUT_BYTES);
  expect(await collect(chunks(bytes, [65536]), "sse")).toEqual(
    parseTrace(source, { format: "sse" }),
  );
});
