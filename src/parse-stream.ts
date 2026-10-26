import { StringDecoder } from "node:string_decoder";
import { parseTrace, TraceInputError, MAX_INPUT_BYTES } from "./parse";
import type { SourceEvent, LintSessionOptions, LintResult } from "./types";
import { createLintSession } from "./lint";

/** Parse byte streams without retaining previously emitted records or frames. */
export async function* parseTraceStream(
  chunks: AsyncIterable<Uint8Array>,
  options: { format?: "ndjson" | "sse" } = {},
): AsyncGenerator<SourceEvent> {
  const format = options.format ?? "ndjson";
  if (format !== "ndjson" && format !== "sse")
    throw new TraceInputError(
      "PARSE_FORMAT",
      "Streaming input must be NDJSON or SSE",
    );
  const decoder = new StringDecoder("utf8");
  let bytes = 0;
  let line = 1;
  let index = 0;
  let afterCr = false;
  let parts: string[] = [];
  // Merge segments geometrically so one-byte chunks do not create millions
  // of retained array entries or repeatedly flatten the entire pending line.
  const append = (part: string) => {
    if (!part) return;
    while (parts.length && parts[parts.length - 1]!.length <= part.length)
      part = parts.pop()! + part;
    parts.push(part);
  };
  let frame: string[] = [];
  let frameLine = 1;
  const parse = (text: string, startLine: number): SourceEvent[] => {
    // Later BOM-prefixed fields are unknown SSE fields, not a new document BOM.
    // Replace that one field-name character without shifting source coordinates
    // or adding bytes/lines to the batch parser's per-frame limit checks.
    const input =
      format === "sse" && startLine > 1 && text.startsWith("\ufeff")
        ? "x" + text.slice(1)
        : text;
    try {
      return parseTrace(input, { format }).map((record) => ({
        ...record,
        eventIndex: index++,
        line: record.line + startLine - 1,
      }));
    } catch (error) {
      if (error instanceof TraceInputError) {
        if (error.code === "PARSE_EMPTY") return [];
        throw new TraceInputError(
          error.code,
          error.message,
          error.line + startLine - 1,
          error.column,
        );
      }
      throw error;
    }
  };
  const consumeLine = (text: string, terminated: boolean): SourceEvent[] => {
    if (format === "ndjson") return text.trim() ? parse(text, line) : [];
    frame.push(text + (terminated ? "\n" : ""));
    if (text === "" && terminated) {
      const text = frame.join("");
      frame = [];
      const records = parse(text, frameLine);
      frameLine = line + 1;
      return records;
    }
    return [];
  };
  function* consume(text: string): Generator<SourceEvent> {
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (afterCr) {
        afterCr = false;
        if (c === "\n") {
          start = i + 1;
          continue;
        }
      }
      if (c !== "\r" && c !== "\n") continue;
      append(text.slice(start, i));
      // Count physical lines, including a trailing empty line, as batch mode does.
      if (line >= 100_000)
        throw new TraceInputError(
          "PARSE_LINES",
          "Trace exceeds the 100,000-line limit",
          100_001,
          1,
        );
      yield* consumeLine(parts.join(""), true);
      parts = [];
      line++;
      afterCr = c === "\r";
      start = i + 1;
    }
    if (start < text.length) append(text.slice(start));
  }
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array))
      throw new TypeError("Streaming chunks must be Uint8Array values");
    bytes += chunk.byteLength;
    if (bytes > MAX_INPUT_BYTES)
      throw new TraceInputError(
        "PARSE_LIMIT",
        "Trace exceeds the 10 MiB input limit",
      );
    yield* consume(
      decoder.write(
        Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      ),
    );
  }
  yield* consume(decoder.end());
  if (parts.length) yield* consumeLine(parts.join(""), false);
  if (format === "sse" && frame.length) yield* parse(frame.join(""), frameLine);
  if (index === 0)
    throw new TraceInputError("PARSE_EMPTY", "Trace contains no events");
}

/** Finalize only after a clean source EOF; propagate parse/transport failures. */
export async function lintTraceStream(
  chunks: AsyncIterable<Uint8Array>,
  options: LintSessionOptions & { format?: "ndjson" | "sse" } = {},
): Promise<LintResult> {
  const session = createLintSession(options);
  try {
    for await (const record of parseTraceStream(chunks, options))
      session.push(record);
    return session.finish();
  } catch (error) {
    session.cancel();
    throw error;
  }
}
