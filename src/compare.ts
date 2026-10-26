import { createHash } from "node:crypto";
import type { Event } from "@ag-ui/core";
import { EventSchemas } from "@ag-ui/core/schemas";
import { normalizeJsonTrace } from "./json-trace";
import { lintEvents } from "./lint";
import { ChunkNormalizer } from "./normalize-chunks";
import { StatePatches } from "./state-patches";
import type { LintOptions, LintResult, SourceEvent } from "./types";

export type CompareOptions = LintOptions & {
  policy?: "adapter-upgrade/v1";
  maxDifferences?: number;
};
type Point = { eventIndex: number; line: number; column: number };
export type ComparisonIssue = {
  side: "before" | "after";
  code: string;
  message: string;
  source?: Point;
};
export type EntityMapping = {
  kind: string;
  scope: string;
  alias: string;
  id: string;
  shortened: boolean;
  source: Point;
};
export type StateOutcome = {
  thread: string;
  status: "not-recorded" | "known" | "unknown";
  sha256?: string;
};
export type TraceDifference = {
  kind: "event" | "state";
  fields: string[];
  fieldsOmitted: number;
  before?: Point & { type: string };
  after?: Point & { type: string };
  thread?: string;
};
export type TraceComparison = {
  schemaVersion: 1;
  policy: "adapter-upgrade/v1";
  status: "equal" | "changed" | "incomparable";
  protocol: { before: LintResult; after: LintResult };
  issues: ComparisonIssue[];
  differences: TraceDifference[];
  differenceCount: number;
  differencesOmitted: number;
  mappings: {
    before: EntityMapping[];
    after: EntityMapping[];
    beforeOmitted: number;
    afterOmitted: number;
  };
  states: { before: StateOutcome[]; after: StateOutcome[] };
  summary: {
    beforeEvents: number;
    afterEvents: number;
    beforeCanonicalEvents: number;
    afterCanonicalEvents: number;
  };
};
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, (item as Record<string, unknown>)[key]]),
        )
      : item,
  ) ?? "<absent>";
const point = ({ eventIndex, line, column }: SourceEvent): Point => ({
  eventIndex,
  line,
  column,
});
const label = (value: string) =>
  value.length > 160 ? value.slice(0, 160) + "… [shortened]" : value;
type Json = Record<string, unknown>;
type Row = {
  event: Json;
  source: Point & { type: string };
  key: string;
  mergeKey?: string;
};
type Thread = {
  alias: string;
  ids: Map<string, Map<string, string>>;
  owners: Map<string, string>;
  runCount: number;
  observedState: boolean;
};

function project(
  records: readonly SourceEvent[],
  validation: LintResult,
  side: "before" | "after",
  options: CompareOptions,
) {
  const issues: ComparisonIssue[] = [],
    issueCodes = new Set<string>();
  const issue = (code: string, message: string, record?: SourceEvent) => {
    if (!issueCodes.has(code)) {
      issueCodes.add(code);
      issues.push({
        side,
        code,
        message,
        ...(record ? { source: point(record) } : {}),
      });
    }
  };
  for (const diagnostic of validation.diagnostics) {
    if (
      diagnostic.ruleId === "SCHEMA_EVENT" ||
      diagnostic.ruleId.startsWith("LIMIT_")
    )
      issue(
        "input-coverage",
        "Schema or resource limits prevent a complete projection",
      );
    if (
      /^(STATE|ACTIVITY)_(BASELINE|PATCH|LIMIT|CONTENT)$/.test(
        diagnostic.ruleId,
      )
    )
      issue(
        "unknown-state",
        "A state/activity validation warning prevents a verified comparison",
      );
    if (
      diagnostic.ruleId === "FL001" ||
      (options.allowPartial && diagnostic.ruleId === "FL012")
    )
      issue(
        "partial-boundary",
        "Partial capture boundaries do not establish complete run behavior",
      );
  }
  const mappings: EntityMapping[] = [];
  let mappingCount = 0;
  const threads = new Map<string, Thread>();
  const threadFor = (id: string, record: SourceEvent) => {
    let thread = threads.get(id);
    if (!thread) {
      thread = {
        alias: `thread:${threads.size}`,
        ids: new Map(),
        owners: new Map(),
        runCount: 0,
        observedState: false,
      };
      threads.set(id, thread);
      addMapping("thread", "global", thread.alias, id, record);
    }
    return thread;
  };
  function addMapping(
    kind: string,
    scope: string,
    alias: string,
    id: string,
    record: SourceEvent,
  ) {
    mappingCount++;
    if (mappings.length < 2000)
      mappings.push({
        kind,
        scope,
        alias,
        id: label(id),
        shortened: id.length > 160,
        source: point(record),
      });
  }
  const alias = (
    kind: string,
    id: unknown,
    thread: Thread,
    record: SourceEvent,
  ): unknown => {
    if (typeof id !== "string") return id;
    const scope = kind === "agent" || kind === "span" ? run : thread.alias;
    const key = `${scope}/${kind}`;
    const ids = thread.ids.get(key) ?? new Map<string, string>();
    thread.ids.set(key, ids);
    let value = ids.get(id);
    if (value === undefined) {
      value = `${scope}/${kind}:${ids.size}`;
      ids.set(id, value);
      addMapping(kind, scope, value, id, record);
    }
    return value;
  };
  const state = new StatePatches(() =>
    issue("unknown-state", "State outcome could not be verified"),
  );
  let active: Thread | undefined;
  let run = "unscoped";
  const history = (messages: unknown, thread: Thread, record: SourceEvent) => {
    if (!Array.isArray(messages)) return messages;
    return messages.map((value: Json) => {
      const message: Json = {
        ...value,
        id: alias("message", value.id, thread, record),
      };
      if (value.subagentRunId !== undefined) {
        if (thread.runCount > 1)
          issue(
            "history-scope",
            "Historical subagent ownership across runs has no unique scope in this policy",
            record,
          );
        message.subagentRunId = alias(
          "agent",
          value.subagentRunId,
          thread,
          record,
        );
      }
      thread.owners.set(
        `${value.role === "reasoning" ? "reasoning" : value.role === "activity" ? "activity" : "message"}:${String(value.id)}`,
        typeof message.subagentRunId === "string" ? message.subagentRunId : "",
      );
      if (Array.isArray(value.toolCalls))
        message.toolCalls = value.toolCalls.map((tool: Json) => {
          thread.owners.set(
            `tool:${String(tool.id)}`,
            typeof message.subagentRunId === "string"
              ? message.subagentRunId
              : "",
          );
          return { ...tool, id: alias("tool", tool.id, thread, record) };
        });
      if (value.toolCallId !== undefined)
        message.toolCallId = alias("tool", value.toolCallId, thread, record);
      return message;
    });
  };
  const rows: Row[] = [];
  const open = new Map<string, { id: unknown; shape: string }[]>();
  const emit = (raw: Json, record: SourceEvent) => {
    const type = String(raw.type);
    if (type === "RUN_STARTED") {
      active = threadFor(String(raw.threadId), record);
      run = String(alias("run", raw.runId, active, record));
      active.runCount++;
      active.owners.clear();
      open.clear();
    }
    const thread = active ?? threadFor("<unscoped>", record);
    const event = { ...raw };
    delete event.timestamp;
    for (const key of Object.keys(event))
      if (event[key] === undefined) delete event[key];
    if (type === "TEXT_MESSAGE_START" && event.role === undefined)
      event.role = "assistant";
    if (type === "REASONING_MESSAGE_START" && event.role === undefined)
      event.role = "reasoning";
    // Fixed field order makes alias assignment independent of JSON object key order.
    if (typeof raw.threadId === "string")
      event.threadId = threadFor(raw.threadId, record).alias;
    for (const [key, kind] of [
      ["runId", "run"],
      ["messageId", "message"],
      ["toolCallId", "tool"],
      ["parentMessageId", "message"],
      ["subagentRunId", "agent"],
      ["parentSubagentRunId", "agent"],
    ] as const)
      if (raw[key] !== undefined)
        event[key] = alias(
          key === "messageId" &&
            (type === "REASONING_START" || type === "REASONING_END")
            ? "span"
            : kind,
          raw[key],
          thread,
          record,
        );
    const family = type.startsWith("TOOL_CALL_")
      ? "tool"
      : type.startsWith("TEXT_MESSAGE_")
        ? "message"
        : type.startsWith("REASONING_MESSAGE_")
          ? "reasoning"
          : type === "REASONING_START" || type === "REASONING_END"
            ? "span"
            : type.startsWith("ACTIVITY_")
              ? "activity"
              : undefined;
    const id = family === "tool" ? raw.toolCallId : raw.messageId;
    if (family && typeof id === "string") {
      const key = `${family}:${id}`;
      let owner = event.subagentRunId;
      if (
        owner === undefined &&
        !(type === "ACTIVITY_SNAPSHOT" && raw.replace !== false)
      )
        owner =
          thread.owners.get(key) ||
          (family === "tool" && typeof raw.parentMessageId === "string"
            ? thread.owners.get(`message:${raw.parentMessageId}`)
            : undefined);
      if (owner) event.subagentRunId = owner;
      if (
        type.endsWith("_START") ||
        (type === "ACTIVITY_SNAPSHOT" &&
          (raw.replace !== false || !thread.owners.has(key)))
      )
        thread.owners.set(key, typeof owner === "string" ? owner : "");
      if (type === "TOOL_CALL_RESULT" && typeof raw.messageId === "string")
        thread.owners.set(
          `message:${raw.messageId}`,
          typeof owner === "string" ? owner : "",
        );
    }
    if (type === "RUN_STARTED" && raw.input && typeof raw.input === "object") {
      const input = { ...(raw.input as Json) };
      const inputThread =
        typeof input.threadId === "string"
          ? threadFor(input.threadId, record)
          : thread;
      if (input.threadId !== undefined) input.threadId = inputThread.alias;
      if (input.runId !== undefined)
        input.runId = alias("run", input.runId, inputThread, record);
      if (input.messages !== undefined)
        input.messages = history(input.messages, thread, record);
      if (Array.isArray(input.resume))
        input.resume = input.resume.map((entry: Json) => ({
          ...entry,
          interruptId: alias("interrupt", entry.interruptId, thread, record),
        }));
      event.input = input;
    }
    if (type === "MESSAGES_SNAPSHOT")
      event.messages = history(raw.messages, thread, record);
    if (
      raw.outcome &&
      typeof raw.outcome === "object" &&
      Array.isArray((raw.outcome as Json).interrupts)
    )
      event.outcome = {
        ...(raw.outcome as Json),
        interrupts: ((raw.outcome as Json).interrupts as Json[]).map(
          (value) => ({
            ...value,
            id: alias("interrupt", value.id, thread, record),
            ...(value.toolCallId !== undefined
              ? { toolCallId: alias("tool", value.toolCallId, thread, record) }
              : {}),
            ...(value.subagentRunId !== undefined
              ? {
                  subagentRunId: alias(
                    "agent",
                    value.subagentRunId,
                    thread,
                    record,
                  ),
                }
              : {}),
          }),
        ),
      };
    if (type === "ACTIVITY_DELTA")
      issue(
        "unsupported-activity",
        "Activity delta outcome comparison is not supported by this policy",
        record,
      );
    if (
      type === "STATE_SNAPSHOT" ||
      type === "STATE_DELTA" ||
      (type === "RUN_STARTED" && raw.input)
    )
      thread.observedState = true;
    state.observe(raw as Event, record);
    const start =
      type.endsWith("_START") ||
      type === "REASONING_START" ||
      type === "SUBAGENT_STARTED";
    const end =
      type.endsWith("_END") ||
      type === "REASONING_END" ||
      type === "SUBAGENT_FINISHED" ||
      type === "SUBAGENT_ERROR";
    const group =
      type === "SUBAGENT_STARTED" || type.startsWith("SUBAGENT_")
        ? "agent"
        : family;
    const identity =
      group === "agent"
        ? event.subagentRunId
        : group === "tool"
          ? event.toolCallId
          : event.messageId;
    if (group && start) {
      const fields = { ...event };
      delete fields.messageId;
      delete fields.toolCallId;
      if (group === "agent") delete fields.subagentRunId;
      const shape = stable(fields);
      const others = open.get(group) ?? [];
      if (others.some((item) => item.id !== identity && item.shape === shape))
        issue(
          "ambiguous-entities",
          "Concurrent entities have indistinguishable opening attributes; this policy cannot prove a unique correspondence",
          record,
        );
      others.push({ id: identity, shape });
      open.set(group, others);
    } else if (group && end)
      open.set(
        group,
        (open.get(group) ?? []).filter((item) => item.id !== identity),
      );
    const merge =
      [
        "TEXT_MESSAGE_CONTENT",
        "REASONING_MESSAGE_CONTENT",
        "TOOL_CALL_ARGS",
      ].includes(type) && typeof event.delta === "string";
    const base = { ...event };
    delete base.delta;
    const mergeKey = merge ? stable(base) : undefined;
    if (
      merge &&
      event.delta === "" &&
      Object.keys(base).every((key) =>
        ["type", "messageId", "toolCallId", "subagentRunId"].includes(key),
      )
    )
      return;
    const previous = rows.at(-1);
    if (mergeKey !== undefined && previous?.mergeKey === mergeKey)
      previous.event.delta = String(previous.event.delta) + event.delta;
    else
      rows.push({
        event,
        source: { ...point(record), type },
        key: "",
        ...(mergeKey ? { mergeKey } : {}),
      });
  };
  let normalizer = new ChunkNormalizer(() =>
    issue(
      "chunk-normalization",
      "Chunk normalization was ambiguous or invalid",
    ),
  );
  const chunks = records.some((r) =>
    String((r.event as Json | null)?.type).endsWith("_CHUNK"),
  );
  if (chunks && !validation.valid)
    issue(
      "chunk-normalization",
      "Protocol errors prevent a complete chunk projection",
    );
  for (const record of records) {
    const parsed = EventSchemas.safeParse(record.event);
    if (!parsed.success) {
      issue(
        "input-coverage",
        "An event is outside the pinned schema projection",
        record,
      );
      continue;
    }
    const raw = record.event as Json;
    const pending: unknown[] = [raw];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      if (
        "encryptedValue" in value ||
        raw.type === "REASONING_ENCRYPTED_VALUE"
      ) {
        issue(
          "encrypted-history",
          "Opaque encrypted history cannot be semantically compared",
          record,
        );
        break;
      }
      for (const child of Object.values(value)) pending.push(child);
    }
    if (
      chunks &&
      String(raw.type).endsWith("_CHUNK") &&
      Object.keys(raw).some((key) => !(key in parsed.data))
    )
      issue(
        "chunk-extensions",
        "Chunk expansion would discard undeclared extension fields",
        record,
      );
    if (raw.type === "RUN_STARTED" || raw.type === "RUN_ERROR")
      normalizer = new ChunkNormalizer(() =>
        issue(
          "chunk-normalization",
          "Chunk normalization was ambiguous or invalid",
        ),
      );
    for (const event of chunks
      ? normalizer.push(raw as Event, record, !!options.allowPartial)
      : [raw])
      emit(event as unknown as Json, record);
  }
  const outcomes: StateOutcome[] = [];
  for (const snapshot of state.snapshots()) {
    const thread = threads.get(snapshot.threadId ?? "<unscoped>");
    if (!thread) continue;
    outcomes.push({
      thread: thread.alias,
      status: !thread.observedState
        ? "not-recorded"
        : snapshot.known
          ? "known"
          : "unknown",
      ...(thread.observedState && snapshot.known
        ? { sha256: sha256(stable(snapshot.value)) }
        : {}),
    });
  }
  for (const row of rows) row.key = stable(row.event);
  return {
    rows,
    issues,
    mappings,
    mappingsOmitted: mappingCount - mappings.length,
    states: outcomes,
  };
}

export function compareTraces(
  before: readonly SourceEvent[],
  after: readonly SourceEvent[],
  options: CompareOptions = {},
): TraceComparison {
  options = { ...options };
  if (options.policy !== undefined && options.policy !== "adapter-upgrade/v1")
    throw new RangeError("Unsupported comparison policy");
  const maxDifferences = options.maxDifferences ?? 50;
  if (
    !Number.isSafeInteger(maxDifferences) ||
    maxDifferences < 1 ||
    maxDifferences > 1000
  )
    throw new RangeError(
      "Comparison maxDifferences must be between 1 and 1000",
    );
  const left = normalizeJsonTrace(
    before,
    "COMPARE_INPUT",
    "Comparison",
  ).records;
  const right = normalizeJsonTrace(
    after,
    "COMPARE_INPUT",
    "Comparison",
  ).records;
  const protocol = {
    before: lintEvents(left, options),
    after: lintEvents(right, options),
  };
  const a = project(left, protocol.before, "before", options),
    b = project(right, protocol.after, "after", options);
  const issues = [...a.issues, ...b.issues];
  const differences: TraceDifference[] = [];
  let differenceCount = 0;
  for (let i = 0; i < Math.max(a.rows.length, b.rows.length); i++) {
    const x = a.rows[i],
      y = b.rows[i];
    if (x?.key === y?.key) continue;
    differenceCount++;
    if (differences.length >= maxDifferences) continue;
    const fields =
      x && y
        ? [...new Set([...Object.keys(x.event), ...Object.keys(y.event)])]
            .sort()
            .filter((key) => stable(x.event[key]) !== stable(y.event[key]))
        : ["event"];
    differences.push({
      kind: "event",
      fields: fields.slice(0, 20).map(label),
      fieldsOmitted: Math.max(0, fields.length - 20),
      ...(x ? { before: x.source } : {}),
      ...(y ? { after: y.source } : {}),
    });
  }
  const statesA = new Map(a.states.map((s) => [s.thread, s]));
  const statesB = new Map(b.states.map((s) => [s.thread, s]));
  for (const thread of new Set([...statesA.keys(), ...statesB.keys()])) {
    const x = statesA.get(thread),
      y = statesB.get(thread);
    if (stable(x) === stable(y)) continue;
    differenceCount++;
    if (differences.length < maxDifferences)
      differences.push({
        kind: "state",
        thread,
        fields: ["final-state"],
        fieldsOmitted: 0,
      });
  }
  if (!differenceCount && (!protocol.before.valid || !protocol.after.valid))
    issues.push({
      side: !protocol.before.valid ? "before" : "after",
      code: "invalid-equivalence",
      message:
        "Matching projections with protocol errors do not establish equivalence",
    });
  return {
    schemaVersion: 1,
    policy: "adapter-upgrade/v1",
    status: issues.length
      ? "incomparable"
      : differenceCount
        ? "changed"
        : "equal",
    protocol,
    issues,
    differences,
    differenceCount,
    differencesOmitted: differenceCount - differences.length,
    mappings: {
      before: a.mappings,
      after: b.mappings,
      beforeOmitted: a.mappingsOmitted,
      afterOmitted: b.mappingsOmitted,
    },
    states: { before: a.states, after: b.states },
    summary: {
      beforeEvents: before.length,
      afterEvents: after.length,
      beforeCanonicalEvents: a.rows.length,
      afterCanonicalEvents: b.rows.length,
    },
  };
}
