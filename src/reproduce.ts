import { normalizeJsonTrace, serializeJsonRecords } from "./json-trace";
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { lintEvents } from "./lint";
import { parseTrace, TraceInputError } from "./parse";
import type { Diagnostic, LintOptions, LintResult, SourceEvent } from "./types";
import packageJson from "../package.json";

const supported = new Set([
  "FL002",
  "FL004",
  "FL005",
  "FL006",
  "FL007",
  "FL008",
  "RUN_IDENTITY",
  "RUN_TRANSITION",
  "ITEM_REOPEN",
]);
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const serialize = (records: readonly SourceEvent[]) =>
  serializeJsonRecords(records, "Reproducer");
// Ignore encoding-dependent line/column values, retaining original event identity.
const signature = (d: Diagnostic) =>
  JSON.stringify({
    ruleId: d.ruleId,
    severity: d.severity,
    message: d.message,
    eventIndex: d.eventIndex,
    context: d.context,
    related: d.related?.map((r) => ({
      eventIndex: r.eventIndex,
      message: r.message,
    })),
  });
export type ReproFinding = {
  id: string;
  diagnostic: Diagnostic;
  supported: boolean;
  reason?: string;
};
export type ReproProgress = {
  checks: number;
  retainedEvents: number;
  elapsedMs: number;
};
export type ReproOptions = LintOptions & {
  findingId: string;
  maxChecks?: number;
  maxDurationMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ReproProgress) => void;
};
export type Reproducer = {
  schemaVersion: 1;
  fingerprintVersion: 1;
  flowlintVersion: string;
  protocol: "ag-ui/1.0";
  options: { allowPartial: boolean };
  finding: ReproFinding;
  stopReason:
    "complete" | "check-limit" | "time-limit" | "cancelled" | "unsupported";
  changed: boolean;
  inputSha256: string;
  outputSha256: string;
  transformations: ("event-deletion" | "ndjson-serialization")[];
  ndjson: string;
  mapping: {
    eventIndex: number;
    original: { eventIndex: number; line: number; column: number };
  }[];
  pinnedOriginalIndices: number[];
  validation: LintResult;
  stats: {
    originalEvents: number;
    retainedEvents: number;
    removedEvents: number;
    checks: number;
    elapsedMs: number;
    maxChecks: number;
    maxDurationMs: number;
  };
};
function prepare(input: readonly SourceEvent[], options: LintOptions) {
  const { records, text: ndjson } = normalizeJsonTrace(
    input,
    "REPRO_INPUT",
    "Reproducer",
  );
  const validation = lintEvents(records, options);
  let reason: string | undefined;
  if (
    validation.diagnostics.some(
      (d) =>
        d.ruleId.startsWith("LIMIT_") ||
        d.ruleId.endsWith("_LIMIT") ||
        d.ruleId === "SCHEMA_EVENT",
    )
  )
    reason = "Schema or resource-limit findings prevent reliable reduction";
  if (
    records.some((r) => {
      const type = (r.event as Record<string, unknown> | null)?.type;
      return (
        typeof type === "string" &&
        (type.endsWith("_CHUNK") ||
          type === "STATE_DELTA" ||
          type === "ACTIVITY_DELTA" ||
          type === "REASONING_ENCRYPTED_VALUE")
      );
    })
  )
    reason =
      "Chunk shorthand, patches, and encrypted-history traces are not supported for reduction";
  const values: unknown[] = records.map((r) => r.event);
  while (values.length) {
    const value = values.pop();
    if (!value || typeof value !== "object") continue;
    if ("encryptedValue" in value) {
      reason = "Encrypted-history traces are not supported for reduction";
      break;
    }
    for (const child of Object.values(value)) values.push(child);
  }
  const inputHash = sha256(ndjson);
  const findings = validation.diagnostics.map((d, diagnosticIndex) => ({
    id:
      "repro-v1:" +
      sha256(
        JSON.stringify([
          inputHash,
          !!options.allowPartial,
          diagnosticIndex,
          signature(d),
        ]),
      ),
    diagnostic: d,
    supported: !reason && supported.has(d.ruleId),
    ...(!supported.has(d.ruleId) || reason
      ? { reason: reason ?? "This rule has no supported dependency model" }
      : {}),
  }));
  return { records, validation, findings, ndjson };
}
/** List versioned identities for the findings in this exact recorded event sequence. */
export function getReproFindings(
  records: readonly SourceEvent[],
  options: LintOptions = {},
): ReproFinding[] {
  return prepare(records, options).findings;
}
function dependencies(
  records: readonly SourceEvent[],
  target: Diagnostic,
): Set<number> {
  const pinned = new Set<number>([0, records.length - 1]);
  const messages = new Map<string, number[]>(),
    tools = new Map<string, number[]>();
  const positions = new Map<number, number>();
  const events = records.map((r) => r.event as Record<string, unknown>);
  const add = (map: Map<string, number[]>, id: unknown, i: number) => {
    if (typeof id === "string") {
      const list = map.get(id) ?? [];
      list.push(i);
      map.set(id, list);
    }
  };
  records.forEach((r, i) => {
    positions.set(r.eventIndex, i);
    const e = events[i]!;
    add(messages, e.messageId, i);
    add(tools, e.toolCallId, i);
    // Everything except explicit text/tool events and stateless RAW/CUSTOM records
    // is context. In particular, run boundaries and authoritative snapshots stay.
    if (
      typeof e.type !== "string" ||
      !/^(TEXT_MESSAGE_(START|CONTENT|END)|TOOL_CALL_(START|ARGS|END|RESULT)|RAW|CUSTOM)$/.test(
        e.type,
      )
    )
      pinned.add(i);
  });
  const queue: number[] = [];
  for (const index of [
    target.eventIndex,
    ...(target.related ?? []).map((r) => r.eventIndex),
  ]) {
    const position = index === undefined ? undefined : positions.get(index);
    if (position !== undefined) {
      pinned.add(position);
      queue.push(position);
    }
  }
  const visited = new Set<number>();
  const expandedMessages = new Set<string>(),
    expandedTools = new Set<string>();
  while (queue.length) {
    const position = queue.pop()!;
    if (visited.has(position)) continue;
    visited.add(position);
    pinned.add(position);
    const e = events[position]!;
    for (const [map, expanded, id] of [
      [messages, expandedMessages, e.messageId],
      [messages, expandedMessages, e.parentMessageId],
      [tools, expandedTools, e.toolCallId],
    ] as const) {
      if (typeof id !== "string" || expanded.has(id)) continue;
      expanded.add(id);
      for (const dependency of map.get(id) ?? [])
        if (!visited.has(dependency)) queue.push(dependency);
    }
  }
  return pinned;
}
/** Delete events only. Every accepted candidate preserves the original failure predicate. */
export async function minimizeTrace(
  input: readonly SourceEvent[],
  options: ReproOptions,
): Promise<Reproducer> {
  options = { ...options };
  const started = performance.now();
  const maxChecks = options.maxChecks ?? 200,
    maxDurationMs = options.maxDurationMs ?? 5000;
  if (
    !Number.isSafeInteger(maxChecks) ||
    maxChecks < 1 ||
    maxChecks > 10000 ||
    !Number.isSafeInteger(maxDurationMs) ||
    maxDurationMs < 1 ||
    maxDurationMs > 60000
  )
    throw new RangeError(
      "Reduction budgets require maxChecks 1–10000 and maxDurationMs 1–60000",
    );
  const lintOptions = {
    protocol: options.protocol,
    allowPartial: !!options.allowPartial,
  };
  const original = prepare(input, lintOptions);
  const finding = original.findings.find((f) => f.id === options.findingId);
  if (!finding)
    throw new TraceInputError(
      "REPRO_FINDING",
      "Finding ID was not found; list findings using the same capture options",
    );
  const target = signature(finding.diagnostic);
  const known = new Map<string, number>();
  for (const diagnostic of original.validation.diagnostics) {
    const key = signature(diagnostic);
    known.set(key, (known.get(key) ?? 0) + 1);
  }
  const preserves = (signatures: string[]) => {
    if (!signatures.includes(target)) return false;
    const seen = new Map<string, number>();
    for (const key of signatures) {
      const count = (seen.get(key) ?? 0) + 1;
      if (count > (known.get(key) ?? 0)) return false;
      seen.set(key, count);
    }
    return true;
  };
  const pinned = finding.supported
    ? dependencies(original.records, finding.diagnostic)
    : new Set(original.records.map((_, i) => i));
  let kept = original.records.map((_, i) => i),
    checks = 0;
  let stopReason: Reproducer["stopReason"] = finding.supported
    ? "complete"
    : "unsupported";
  const elapsed = () => Math.round(performance.now() - started);
  let removable = kept.filter((i) => !pinned.has(i));
  let partitions = 2;
  search: while (finding.supported && removable.length) {
    const size = Math.ceil(removable.length / partitions);
    let accepted = false;
    for (let offset = 0; offset < removable.length; offset += size) {
      await setImmediate(); // Permit cancellation and progress observers between synchronous checks.
      if (options.signal?.aborted) {
        stopReason = "cancelled";
        break search;
      }
      if (checks >= maxChecks) {
        stopReason = "check-limit";
        break search;
      }
      if (performance.now() - started >= maxDurationMs) {
        stopReason = "time-limit";
        break search;
      }
      const remove = new Set(removable.slice(offset, offset + size));
      const candidate = kept.filter((i) => !remove.has(i));
      const result = lintEvents(
        candidate.map((i) => original.records[i]!),
        lintOptions,
      );
      checks++;
      const signatures = result.diagnostics.map(signature);
      if (
        signatures.includes(target) &&
        signatures.every((s) => known.has(s))
      ) {
        kept = candidate;
        removable = removable.filter((i) => !remove.has(i));
        partitions = Math.max(2, partitions - 1);
        accepted = true;
      }
      options.onProgress?.({
        checks,
        retainedEvents: kept.length,
        elapsedMs: elapsed(),
      });
      if (accepted) break;
    }
    if (!accepted) {
      if (partitions >= removable.length) break;
      partitions = Math.min(removable.length, partitions * 2);
    }
  }
  if (finding.supported && options.signal?.aborted) stopReason = "cancelled";
  const retained = kept.map((i) => original.records[i]!);
  const ndjson = serialize(retained);
  const outputRecords = parseTrace(ndjson, { format: "ndjson" });
  const validation = lintEvents(outputRecords, lintOptions);
  // Revalidate the serialized artifact and translate every finding back to source
  // identity. This catches changes hidden by reindexing or output serialization.
  const rebased = validation.diagnostics
    .map((d) => ({
      ...d,
      eventIndex:
        d.eventIndex === undefined
          ? undefined
          : retained[d.eventIndex]?.eventIndex,
      related: d.related?.map((r) => ({
        ...r,
        eventIndex: retained[r.eventIndex]!.eventIndex,
      })),
    }))
    .map(signature);
  if (!preserves(rebased))
    throw new TraceInputError(
      "REPRO_VERIFY",
      "Serialized reproducer failed fidelity verification; no bundle should be written",
    );
  return {
    schemaVersion: 1,
    fingerprintVersion: 1,
    flowlintVersion: packageJson.version,
    protocol: "ag-ui/1.0",
    options: { allowPartial: !!options.allowPartial },
    finding,
    stopReason,
    changed: kept.length < original.records.length,
    inputSha256: sha256(original.ndjson),
    outputSha256: sha256(ndjson),
    transformations:
      kept.length < original.records.length
        ? ["event-deletion", "ndjson-serialization"]
        : ["ndjson-serialization"],
    ndjson,
    mapping: retained.map((r, eventIndex) => ({
      eventIndex,
      original: { eventIndex: r.eventIndex, line: r.line, column: r.column },
    })),
    pinnedOriginalIndices: [...pinned]
      .sort((a, b) => a - b)
      .map((i) => original.records[i]!.eventIndex),
    validation,
    stats: {
      originalEvents: original.records.length,
      retainedEvents: retained.length,
      removedEvents: original.records.length - retained.length,
      checks,
      elapsedMs: elapsed(),
      maxChecks,
      maxDurationMs,
    },
  };
}
