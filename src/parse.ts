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
  if (!["auto", "json", "ndjson"].includes(format))
    throw new TraceInputError("PARSE_FORMAT", "Unsupported input format");
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") starts.push(i + 1);
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
    const end = text.indexOf("\n", start);
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
