import { eventWithinLimits } from "./input-limits";
import { parseTrace, TraceInputError, MAX_INPUT_BYTES } from "./parse";
import type { SourceEvent } from "./types";

export function serializeJsonRecords(
  records: readonly SourceEvent[],
  label: string,
  code = "REPRO_INPUT",
): string {
  const lines: string[] = [];
  let bytes = 0;
  for (const record of records) {
    const line = JSON.stringify(record.event);
    if (line === undefined)
      throw new TraceInputError(
        code,
        `${label} input must contain JSON-compatible events`,
      );
    bytes += Buffer.byteLength(line) + (lines.length ? 1 : 0);
    if (bytes > MAX_INPUT_BYTES)
      throw new TraceInputError(
        "PARSE_LIMIT",
        `${label} serialization exceeds the 10 MiB input limit`,
      );
    lines.push(line);
  }
  return lines.join("\n");
}

function jsonCompatible(root: unknown): boolean {
  const pending = [root];
  while (pending.length) {
    const value = pending.pop();
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Object.is(value, -0)) return false;
      continue;
    }
    if (typeof value !== "object") return false;
    const array = Array.isArray(value);
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      return false;
    if (Object.getOwnPropertySymbols(value).length) return false;
    if (array) {
      const keys = Object.keys(value);
      if (
        keys.length !== value.length ||
        keys.some((key, i) => key !== String(i))
      )
        return false;
    }
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (array && key === "length") continue;
      if (!("value" in descriptor) || !descriptor.enumerable) return false;
      pending.push(descriptor.value);
    }
  }
  return true;
}
export function normalizeJsonTrace(
  input: readonly SourceEvent[],
  code: string,
  label: string,
): { records: SourceEvent[]; text: string } {
  if (input.length > 100_000)
    throw new TraceInputError(
      code,
      `${label} input exceeds the 100,000-event limit`,
    );
  const indices = new Set<number>();
  for (const record of input) {
    if (
      !Number.isSafeInteger(record.eventIndex) ||
      record.eventIndex < 0 ||
      indices.has(record.eventIndex) ||
      !Number.isSafeInteger(record.line) ||
      record.line < 1 ||
      !Number.isSafeInteger(record.column) ||
      record.column < 1
    )
      throw new TraceInputError(
        code,
        `${label} records require unique event indices and positive source coordinates`,
      );
    indices.add(record.eventIndex);
  }
  if (input.some((r) => !eventWithinLimits(r.event)))
    throw new TraceInputError(
      code,
      `${label} events exceed input limits or contain cycles`,
    );
  if (input.some((r) => !jsonCompatible(r.event)))
    throw new TraceInputError(
      code,
      `${label} input must contain plain JSON values`,
    );
  let ndjson: string;
  try {
    ndjson = serializeJsonRecords(input, label, code);
  } catch (error) {
    if (error instanceof TraceInputError) throw error;
    throw new TraceInputError(
      code,
      `${label} input must contain JSON-compatible events`,
    );
  }
  const parsed = input.length ? parseTrace(ndjson, { format: "ndjson" }) : [];
  if (parsed.length !== input.length)
    throw new TraceInputError(
      code,
      `${label} input must preserve one JSON event per record`,
    );
  const records = parsed.map((r, i) => ({ ...input[i]!, event: r.event }));
  return { records, text: ndjson };
}
