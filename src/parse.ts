import { parseTree, getNodeValue, type ParseError } from "jsonc-parser";
import type { InputFormat, SourceEvent } from "./types";
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export class TraceInputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly line = 1,
    public readonly column = 1,
  ) {
    super(message);
  }
}
export function parseTrace(
  text: string,
  options: { format?: InputFormat } = {},
): SourceEvent[] {
  if (Buffer.byteLength(text) > MAX_INPUT_BYTES)
    throw new TraceInputError(
      "PARSE_LIMIT",
      "Trace exceeds the 10 MiB input limit",
    );
  if (!text.trim())
    throw new TraceInputError("PARSE_EMPTY", "Trace contains no events");
  const format = options.format ?? "auto";
  if (!["auto", "json", "ndjson", "sse"].includes(format))
    throw new TraceInputError("PARSE_FORMAT", "Unsupported input format");
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\r") {
      if (text[i + 1] === "\n") i++;
      starts.push(i + 1);
    } else if (text[i] === "\n") starts.push(i + 1);
  const location = (offset: number) => {
    let lo = 0,
      hi = starts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid;
    }
    return { line: lo + 1, column: offset - starts[lo]! + 1 };
  };
  const firstLine =
    text
      .replace(/^\uFEFF/, "")
      .split(/\r\n|\r|\n/)
      .find((line) => line.length > 0) ?? "";
  if (
    format === "sse" ||
    (format === "auto" &&
      /^(?::|(?:data|event|id|retry)(?::|$))/.test(firstLine))
  )
    return parseSse(text, location);
  const parse = (input: string, offset: number) => {
    const errors: ParseError[] = [];
    const tree = parseTree(input, errors, {
      disallowComments: true,
      allowTrailingComma: false,
    });
    if (errors.length || !tree) {
      const at = location(offset + (errors[0]?.offset ?? 0));
      throw new TraceInputError(
        "PARSE_JSON",
        "Invalid JSON syntax",
        at.line,
        at.column,
      );
    }
    return tree;
  };
  if (
    format === "json" ||
    (format === "auto" && text.trimStart().startsWith("["))
  ) {
    const tree = parse(text, 0);
    if (tree.type !== "array")
      throw new TraceInputError("PARSE_ARRAY", "JSON input must be an array");
    if (!tree.children?.length)
      throw new TraceInputError("PARSE_EMPTY", "Trace contains no events");
    return tree.children.map((node, eventIndex) => ({
      event: getNodeValue(node),
      eventIndex,
      ...location(node.offset),
    }));
  }
  const records: SourceEvent[] = [];
  for (const start of starts) {
    const next = text.slice(start).search(/[\r\n]/);
    const end = next < 0 ? -1 : start + next;
    const line = text.slice(start, end === -1 ? text.length : end);
    if (!line.trim()) continue;
    const tree = parse(line, start);
    records.push({
      event: getNodeValue(tree),
      eventIndex: records.length,
      ...location(start + tree.offset),
    });
  }
  return records;
}

/** Decode SSE data fields while retaining offsets into the original capture. */
function parseSse(
  text: string,
  location: (offset: number) => { line: number; column: number },
): SourceEvent[] {
  const records: SourceEvent[] = [];
  let parts: { value: string; source: number; joined: number }[] = [];
  let length = 0;
  const dispatch = () => {
    if (!parts.length) return;
    const data = parts.map((part) => part.value).join("\n");
    const sourceOffset = (offset: number) => {
      let lo = 0,
        hi = parts.length;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >>> 1;
        if (parts[mid]!.joined <= offset) lo = mid;
        else hi = mid;
      }
      const part = parts[lo]!;
      return part.source + Math.min(part.value.length, offset - part.joined);
    };
    const errors: ParseError[] = [];
    const tree = parseTree(data, errors, {
      disallowComments: true,
      allowTrailingComma: false,
    });
    if (errors.length || !tree) {
      const at = location(sourceOffset(errors[0]?.offset ?? 0));
      throw new TraceInputError(
        "PARSE_JSON",
        "Invalid JSON syntax in SSE data",
        at.line,
        at.column,
      );
    }
    const at = location(sourceOffset(tree.offset));
    if (tree.type !== "object")
      throw new TraceInputError(
        "PARSE_SSE_EVENT",
        "SSE data must contain one JSON event object",
        at.line,
        at.column,
      );
    records.push({
      event: getNodeValue(tree),
      eventIndex: records.length,
      ...at,
    });
    parts = [];
    length = 0;
  };
  let offset = text.startsWith("\uFEFF") ? 1 : 0;
  while (offset < text.length) {
    let end = offset;
    while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end++;
    const line = text.slice(offset, end);
    if (!line) dispatch();
    else if (!line.startsWith(":")) {
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      if (field === "data") {
        let valueStart = colon < 0 ? end : offset + colon + 1;
        if (text[valueStart] === " ") valueStart++;
        const value = text.slice(valueStart, end);
        parts.push({ value, source: valueStart, joined: length });
        length += value.length + 1;
      }
    }
    offset = end + (text[end] === "\r" && text[end + 1] === "\n" ? 2 : 1);
  }
  if (parts.length) {
    const at = location(parts[0]!.source);
    throw new TraceInputError(
      "PARSE_SSE_TRUNCATED",
      "SSE data block ends without a blank-line delimiter",
      at.line,
      at.column,
    );
  }
  if (!records.length)
    throw new TraceInputError("PARSE_EMPTY", "Trace contains no events");
  return records;
}
