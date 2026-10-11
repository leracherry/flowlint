import { EventSchemas } from "@ag-ui/core/schemas";
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
  const normalizer = new ChunkNormalizer(emit);
  const resetItems = () => {
    state.messages = createItemState();
    state.tools = createItemState();
    state.subagentsWarned = false;
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
  ) => {
    if (item.suspended) return;
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
            !item.closed.has(id)
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
    for (const event of normalizer.push(
      original,
      record,
      !!options.allowPartial && state.status === "excerpt",
    )) {
      if (event.type === "RUN_STARTED") {
        if (state.status === "active") {
          emit(
            record,
            "FL006",
            `RUN_STARTED while run ${JSON.stringify(state.run?.runId)} is active`,
          );
          // Reject the nested start rather than discarding the prior run's items.
          continue;
        }
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
      if (state.status === "finished" || state.status === "errored") {
        emit(
          record,
          "RUN_TRANSITION",
          `${event.type} arrives after the run closed`,
        );
        continue;
      }
      if (event.type === "RUN_FINISHED") {
        if (
          state.run &&
          (state.run.threadId !== event.threadId ||
            state.run.runId !== event.runId)
        ) {
          emit(
            record,
            "RUN_IDENTITY",
            "RUN_FINISHED identifiers do not match the active run",
          );
          continue;
        }
        if (!state.run)
          emit(
            record,
            "RUN_TRANSITION",
            "RUN_FINISHED has no observed RUN_STARTED",
            options.allowPartial ? "warning" : "error",
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
        resetItems();
        state.run = undefined;
        state.status = "finished";
        continue;
      }
      // Attribution can be implicit through parent messages. Suspend both item
      // families once subagents appear rather than guessing ownership before attribution support.
      if (
        ("subagentRunId" in event && event.subagentRunId) ||
        event.type.startsWith("SUBAGENT_")
      ) {
        if (!state.subagentsWarned)
          emit(
            record,
            "COVERAGE_SUBAGENTS",
            "Subagent attribution is not implemented; text/tool lifecycle checks are suspended for this run",
            "warning",
          );
        state.subagentsWarned = true;
        state.messages.suspended = true;
        state.messages.open.clear();
        state.tools.suspended = true;
        state.tools.open.clear();
        continue;
      }
      switch (event.type) {
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
      state.tools.open.size)
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
      a.ruleId.localeCompare(b.ruleId),
  );
  return {
    valid: !diagnostics.some((d) => d.severity === "error"),
    protocol: "ag-ui/1.0",
    checkedEvents: records.length,
    supportedRules: [...SUPPORTED_RULES],
    diagnostics,
  };
}
