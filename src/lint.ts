import { EventSchemas } from "@ag-ui/core/schemas";
import type { Diagnostic, LintOptions, LintResult, SourceEvent } from "./types";
const MAX_DIAGNOSTICS = 1000;
export function lintEvents(
  records: readonly SourceEvent[],
  options: LintOptions = {},
): LintResult {
  if (options.protocol && options.protocol !== "ag-ui/1.0")
    throw new Error("Unsupported protocol");
  const diagnostics: Diagnostic[] = [];
  const openMessages = new Set<string>();
  const closedMessages = new Set<string>();
  // Without chunk expansion, omission of a START cannot be established in a chunk-containing run.
  let chunkRun = false;
  let sawRunBoundary = false;
  let capped = false;
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
    const event = parsed.data;
    if ("subagentRunId" in event && event.subagentRunId) continue;
    if (event.type === "RUN_STARTED") {
      openMessages.clear();
      closedMessages.clear();
      chunkRun = false;
      sawRunBoundary = true;
    } else if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
      openMessages.clear();
      closedMessages.clear();
      chunkRun = false;
      sawRunBoundary = false;
    } else if (event.type === "TEXT_MESSAGE_CHUNK") {
      if (!chunkRun)
        emit(
          record,
          "COVERAGE_CHUNKS",
          "Text chunk lifecycle checks are not implemented; FL002 is suspended until the next run boundary",
          "warning",
        );
      chunkRun = true;
    } else if (event.type === "TEXT_MESSAGE_START") {
      openMessages.add(event.messageId);
      closedMessages.delete(event.messageId);
    } else if (
      event.type === "TEXT_MESSAGE_CONTENT" &&
      !chunkRun &&
      !openMessages.has(event.messageId)
    ) {
      emit(
        record,
        "FL002",
        `TEXT_MESSAGE_CONTENT refers to unopened message ${JSON.stringify(event.messageId)}`,
        options.allowPartial &&
          !sawRunBoundary &&
          !closedMessages.has(event.messageId)
          ? "warning"
          : "error",
      );
    } else if (event.type === "TEXT_MESSAGE_END") {
      openMessages.delete(event.messageId);
      closedMessages.add(event.messageId);
    }
  }
  if (capped)
    diagnostics.push({
      ruleId: "LIMIT_DIAGNOSTICS",
      severity: "error",
      message: "Diagnostic limit reached; additional findings omitted",
    });
  return {
    valid: !diagnostics.some((d) => d.severity === "error"),
    protocol: "ag-ui/1.0",
    checkedEvents: records.length,
    supportedRules: ["FL002 (text content)"],
    diagnostics,
  };
}
