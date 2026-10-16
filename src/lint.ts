import { EventSchemas } from "@ag-ui/core/schemas";
import { ActivityPatches } from "./activity-patches";
import { StatePatches } from "./state-patches";
import { Attribution } from "./attribution";
import { ChunkNormalizer } from "./normalize-chunks";
import { createState, createItemState } from "./state";
import type { Diagnostic, LintOptions, LintResult, SourceEvent } from "./types";
const MAX_DIAGNOSTICS = 1000;
export const SUPPORTED_RULES = [
  "FL001",
  "FL002",
  "FL003",
  "FL004",
  "FL005",
  "FL006",
  "FL007",
  "FL008",
  "FL009",
  "FL010",
  "FL011",
  "FL012",
  "RUN_TRANSITION",
  "RUN_IDENTITY",
  "SUBAGENT_START",
  "SUBAGENT_END",
  "SUBAGENT_PARENT",
  "SUBAGENT_OPEN",
  "ATTRIBUTION",
  "REASONING_SPAN_START",
  "REASONING_SPAN_END",
  "REASONING_SPAN_OPEN",
  "REASONING_MESSAGE_START",
  "REASONING_MESSAGE_MISSING",
  "REASONING_MESSAGE_OPEN",
  "STEP_START",
  "STEP_END",
  "STEP_OPEN",
  "STATE_PATCH",
  "STATE_BASELINE",
  "STATE_LIMIT",
  "ACTIVITY_PATCH",
  "ACTIVITY_BASELINE",
  "ACTIVITY_LIMIT",
  "ACTIVITY_CONTENT",
] as const;
export function lintEvents(
  records: readonly SourceEvent[],
  options: LintOptions = {},
): LintResult {
  if (options.protocol && options.protocol !== "ag-ui/1.0")
    throw new Error("Unsupported protocol");
  const diagnostics: Diagnostic[] = [];
  const state = createState();
  let capped = false;
  let lastValid: SourceEvent | undefined;
  const emit = (
    record: SourceEvent,
    ruleId: string,
    message: string,
    severity: Diagnostic["severity"] = "error",
  ) => {
    if (diagnostics.length >= MAX_DIAGNOSTICS) {
      capped = true;
      return;
    }
    const { eventIndex, line, column } = record;
    diagnostics.push({ ruleId, severity, message, eventIndex, line, column });
  };
  const activityPatches = new ActivityPatches(emit);
  const statePatches = new StatePatches(emit);
  let normalizer = new ChunkNormalizer(emit);
  let attribution = new Attribution(emit);
  const resetItems = () => {
    state.messages = createItemState();
    state.tools = createItemState();
    state.reasoningMessages = createItemState();
    state.reasoningSpans = createItemState();
    state.steps.clear();
    state.subagents.clear();
    state.closedSubagents.clear();
    state.attributed.clear();
    attribution = new Attribution(emit);
  };
  const checkItem = (
    record: SourceEvent,
    item: ReturnType<typeof createItemState>,
    id: string,
    operation: "start" | "content" | "end",
    duplicateRule: string,
    missingRule: string,
    eventType: string,
    label: string,
    owner?: string,
  ) => {
    if (operation === "start") {
      if (item.open.has(id))
        emit(
          record,
          duplicateRule,
          `Duplicate ${eventType} for open ${label} ${JSON.stringify(id)}`,
        );
      item.open.add(id);
      item.closed.delete(id);
    } else {
      if (!item.open.has(id))
        emit(
          record,
          missingRule,
          `${eventType} refers to unopened ${label} ${JSON.stringify(id)}`,
          options.allowPartial &&
            state.status === "excerpt" &&
            !item.closed.has(id) &&
            (owner === undefined ||
              (!state.subagents.has(owner) &&
                !state.closedSubagents.has(owner)))
            ? "warning"
            : "error",
        );
      if (operation === "end") {
        item.open.delete(id);
        item.closed.add(id);
      }
    }
  };
  for (const record of records) {
    const parsed = EventSchemas.safeParse(record.event);
    if (!parsed.success) {
      emit(
        record,
        "SCHEMA_EVENT",
        "Event does not match the pinned AG-UI 1.0 schema",
      );
      continue;
    }
    lastValid = record;
    const original = parsed.data;
    // Reject invalid run transitions before they mutate attribution/chunk state.
    if (original.type === "RUN_STARTED" && state.status === "active") {
      emit(record, "FL006", "RUN_STARTED while a run is active");
      continue;
    }
    if (
      original.type === "RUN_FINISHED" &&
      state.run &&
      (state.run.threadId !== original.threadId ||
        state.run.runId !== original.runId)
    ) {
      emit(
        record,
        "RUN_IDENTITY",
        "RUN_FINISHED identifiers do not match the active run",
      );
      continue;
    }
    if (
      (state.status === "finished" || state.status === "errored") &&
      original.type !== "RUN_STARTED" &&
      original.type !== "RUN_ERROR"
    ) {
      emit(
        record,
        "RUN_TRANSITION",
        `${original.type} arrives after the run closed`,
      );
      continue;
    }
    if (original.type === "RUN_STARTED" || original.type === "RUN_ERROR") {
      normalizer = new ChunkNormalizer(emit);
      attribution = new Attribution(emit);
    }
    if (
      state.status === "initial" &&
      original.type !== "RUN_STARTED" &&
      original.type !== "RUN_ERROR"
    ) {
      emit(
        record,
        "FL001",
        "Stream must begin with RUN_STARTED or RUN_ERROR",
        options.allowPartial ? "warning" : "error",
      );
      state.status = "excerpt";
    }
    const owner =
      "subagentRunId" in original && typeof original.subagentRunId === "string"
        ? original.subagentRunId
        : undefined;
    const allowUnseenStep =
      !!options.allowPartial &&
      state.status === "excerpt" &&
      (owner === undefined ||
        (!state.subagents.has(owner) && !state.closedSubagents.has(owner)));
    const activity = activityPatches.observe(original, record);
    if (!activity) continue;
    const resolved = attribution.resolve(activity, record, allowUnseenStep);
    if (!resolved) continue;
    if (
      "subagentRunId" in resolved &&
      typeof resolved.subagentRunId === "string" &&
      !resolved.type.startsWith("SUBAGENT_")
    )
      state.attributed.add(resolved.subagentRunId);
    for (const event of normalizer.push(
      resolved,
      record,
      !!options.allowPartial && state.status === "excerpt",
    )) {
      statePatches.observe(event, record);
      if (event.type === "RUN_STARTED") {
        const seen = state.seenRuns.get(event.threadId) ?? new Set<string>();
        if (seen.has(event.runId))
          emit(
            record,
            "FL007",
            `runId ${JSON.stringify(event.runId)} is reused on thread ${JSON.stringify(event.threadId)}`,
          );
        seen.add(event.runId);
        state.seenRuns.set(event.threadId, seen);
        resetItems();
        attribution.resolve(event, record);
        state.run = { threadId: event.threadId, runId: event.runId };
        state.status = "active";
        continue;
      }
      if (event.type === "RUN_ERROR") {
        if (state.status === "errored")
          emit(
            record,
            "RUN_TRANSITION",
            "Only RUN_STARTED may follow RUN_ERROR",
          );
        resetItems();
        state.run = undefined;
        state.status = "errored";
        continue;
      }
      if (event.type === "RUN_FINISHED") {
        if (!state.run)
          emit(
            record,
            "RUN_TRANSITION",
            "RUN_FINISHED has no observed RUN_STARTED",
            options.allowPartial ? "warning" : "error",
          );
        for (const id of state.subagents)
          emit(
            record,
            "SUBAGENT_OPEN",
            `RUN_FINISHED with active subagent ${JSON.stringify(id)}`,
          );
        for (const id of state.messages.open)
          emit(
            record,
            "FL003",
            `RUN_FINISHED with open text message ${JSON.stringify(id)}`,
          );
        for (const id of state.tools.open)
          emit(
            record,
            "FL009",
            `RUN_FINISHED with open tool call ${JSON.stringify(id)}`,
          );
        for (const [items, rule, label] of [
          [
            state.reasoningMessages,
            "REASONING_MESSAGE_OPEN",
            "reasoning message",
          ],
          [state.reasoningSpans, "REASONING_SPAN_OPEN", "reasoning span"],
        ] as const)
          for (const id of items.open)
            emit(
              record,
              rule,
              `RUN_FINISHED with open ${label} ${JSON.stringify(id)}`,
            );
        for (const [owner, items] of state.steps)
          for (const name of items.open)
            emit(
              record,
              "STEP_OPEN",
              `RUN_FINISHED with open step ${JSON.stringify(name)}${owner === undefined ? "" : ` in subagent ${JSON.stringify(owner)}`}`,
            );
        resetItems();
        state.run = undefined;
        state.status = "finished";
        continue;
      }
      if (event.type === "SUBAGENT_STARTED") {
        const id = event.subagentRunId;
        if (state.subagents.has(id) || state.closedSubagents.has(id)) {
          emit(
            record,
            "SUBAGENT_START",
            `Subagent invocation ${JSON.stringify(id)} is already announced or closed`,
          );
          continue;
        }
        if (state.attributed.has(id))
          emit(
            record,
            "SUBAGENT_START",
            `Subagent ${JSON.stringify(id)} was attributed before its announcement`,
          );
        const parent = event.parentSubagentRunId;
        if (
          parent !== undefined &&
          !state.subagents.has(parent) &&
          !state.closedSubagents.has(parent)
        )
          emit(
            record,
            "SUBAGENT_PARENT",
            `Parent subagent ${JSON.stringify(parent)} has not been announced`,
            options.allowPartial && state.status === "excerpt" && parent !== id
              ? "warning"
              : "error",
          );
        state.subagents.add(id);
        continue;
      }
      if (
        event.type === "SUBAGENT_FINISHED" ||
        event.type === "SUBAGENT_ERROR"
      ) {
        const id = event.subagentRunId;
        if (!state.subagents.delete(id))
          emit(
            record,
            "SUBAGENT_END",
            `${event.type} has no active invocation ${JSON.stringify(id)}`,
            options.allowPartial &&
              state.status === "excerpt" &&
              !state.closedSubagents.has(id)
              ? "warning"
              : "error",
          );
        state.closedSubagents.add(id);
        continue;
      }
      switch (event.type) {
        case "REASONING_START":
        case "REASONING_END":
          checkItem(
            record,
            state.reasoningSpans,
            event.messageId,
            event.type === "REASONING_START" ? "start" : "end",
            "REASONING_SPAN_START",
            "REASONING_SPAN_END",
            event.type,
            "reasoning span",
            event.subagentRunId,
          );
          break;
        case "REASONING_MESSAGE_START":
        case "REASONING_MESSAGE_CONTENT":
        case "REASONING_MESSAGE_END":
          checkItem(
            record,
            state.reasoningMessages,
            event.messageId,
            event.type === "REASONING_MESSAGE_START"
              ? "start"
              : event.type === "REASONING_MESSAGE_END"
                ? "end"
                : "content",
            "REASONING_MESSAGE_START",
            "REASONING_MESSAGE_MISSING",
            event.type,
            "reasoning message",
            event.subagentRunId,
          );
          break;
        case "STEP_STARTED":
        case "STEP_FINISHED": {
          const items =
            state.steps.get(event.subagentRunId) ?? createItemState();
          state.steps.set(event.subagentRunId, items);
          checkItem(
            record,
            items,
            event.stepName,
            event.type === "STEP_STARTED" ? "start" : "end",
            "STEP_START",
            "STEP_END",
            event.type,
            "step",
            event.subagentRunId,
          );
          break;
        }
        case "TEXT_MESSAGE_START":
          checkItem(
            record,
            state.messages,
            event.messageId,
            "start",
            "FL008",
            "FL002",
            event.type,
            "text message",
            event.subagentRunId,
          );
          break;
        case "TEXT_MESSAGE_CONTENT":
          checkItem(
            record,
            state.messages,
            event.messageId,
            "content",
            "FL008",
            "FL002",
            event.type,
            "text message",
            event.subagentRunId,
          );
          break;
        case "TEXT_MESSAGE_END":
          checkItem(
            record,
            state.messages,
            event.messageId,
            "end",
            "FL008",
            "FL002",
            event.type,
            "text message",
            event.subagentRunId,
          );
          break;
        case "TOOL_CALL_START":
          checkItem(
            record,
            state.tools,
            event.toolCallId,
            "start",
            "FL004",
            "FL005",
            event.type,
            "tool call",
            event.subagentRunId,
          );
          break;
        case "TOOL_CALL_ARGS":
          checkItem(
            record,
            state.tools,
            event.toolCallId,
            "content",
            "FL004",
            "FL005",
            event.type,
            "tool call",
            event.subagentRunId,
          );
          break;
        case "TOOL_CALL_END":
          checkItem(
            record,
            state.tools,
            event.toolCallId,
            "end",
            "FL004",
            "FL005",
            event.type,
            "tool call",
            event.subagentRunId,
          );
          break;
      }
    }
  }
  if (
    lastValid &&
    (state.status === "active" ||
      state.status === "excerpt" ||
      state.messages.open.size ||
      state.tools.open.size ||
      state.subagents.size)
  ) {
    emit(
      lastValid,
      "FL012",
      "Capture ends without a run terminal event or with open items",
      options.allowPartial ? "warning" : "error",
    );
  }
  if (capped)
    diagnostics.push({
      ruleId: "LIMIT_DIAGNOSTICS",
      severity: "error",
      message: "Diagnostic limit reached; additional findings omitted",
    });
  diagnostics.sort(
    (a, b) =>
      (a.eventIndex ?? records.length) - (b.eventIndex ?? records.length) ||
      (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0),
  );
  return {
    valid: !diagnostics.some((d) => d.severity === "error"),
    protocol: "ag-ui/1.0",
    checkedEvents: records.length,
    supportedRules: [...SUPPORTED_RULES],
    diagnostics,
  };
}
