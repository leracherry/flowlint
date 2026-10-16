import type { Event } from "@ag-ui/core";
import type { Diagnostic, SourceEvent } from "./types";

type Owner = string | undefined;
type Emit = (
  source: SourceEvent,
  rule: string,
  message: string,
  severity?: Diagnostic["severity"],
) => void;

/** Ownership survives item closure; omitted continuation tags inherit the opener. */
export class Attribution {
  private messages = new Map<string, Owner>();
  private tools = new Map<string, Owner>();
  private reasoning = new Map<string, Owner>();
  private spans = new Map<string, Owner>();
  private steps = new Map<string, Set<Owner>>();
  constructor(private emit: Emit) {}

  resolve(
    event: Event,
    source: SourceEvent,
    allowUnseenStep = false,
  ): Event | undefined {
    if (event.type.startsWith("ACTIVITY_")) return event;
    const e = event as Event & Record<string, unknown>;
    const tag =
      typeof e.subagentRunId === "string" ? e.subagentRunId : undefined;
    let owner = tag;
    if (event.type === "MESSAGES_SNAPSHOT" || event.type === "RUN_STARTED") {
      // Snapshots can include historical producers without announcing a new invocation.
      const messages =
        event.type === "MESSAGES_SNAPSHOT"
          ? event.messages
          : (event.input?.messages ?? []);
      for (const message of messages) {
        const m = message as typeof message & {
          subagentRunId?: string;
          toolCalls?: { id: string }[];
        };
        if (m.role === "activity") continue;
        const bucket = m.role === "reasoning" ? this.reasoning : this.messages;
        bucket.set(m.id, m.subagentRunId);
        for (const tool of m.toolCalls ?? [])
          this.tools.set(tool.id, m.subagentRunId);
      }
      return event;
    }
    if (event.type === "STEP_STARTED" || event.type === "STEP_FINISHED") {
      const owners = this.steps.get(event.stepName) ?? new Set<Owner>();
      if (event.type === "STEP_STARTED") owners.add(tag);
      else if (!owners.delete(tag) && owners.size && !allowUnseenStep) {
        this.emit(
          source,
          "ATTRIBUTION",
          "STEP_FINISHED attribution disagrees with its opener",
        );
        return undefined;
      }
      this.steps.set(event.stepName, owners);
      return event;
    }
    const text = event.type.startsWith("TEXT_MESSAGE_");
    const tool = event.type.startsWith("TOOL_CALL_");
    const reasoning = event.type.startsWith("REASONING_MESSAGE_");
    const span =
      event.type === "REASONING_START" || event.type === "REASONING_END";
    const owners = text
      ? this.messages
      : tool
        ? this.tools
        : reasoning
          ? this.reasoning
          : span
            ? this.spans
            : undefined;
    const id = tool ? e.toolCallId : e.messageId;
    if (!owners || typeof id !== "string") return event;
    const rule = text || tool ? "FL011" : "ATTRIBUTION";
    if (owners.has(id)) {
      owner = owners.get(id);
      if (tag !== undefined && tag !== owner) {
        this.emit(
          source,
          rule,
          `${event.type} attribution conflicts with the item's opening owner`,
        );
        return undefined;
      }
    }
    if (
      tool &&
      typeof e.parentMessageId === "string" &&
      this.messages.has(e.parentMessageId)
    ) {
      const parent = this.messages.get(e.parentMessageId);
      if (
        (tag !== undefined && tag !== parent) ||
        (owners.has(id) && owner !== parent)
      ) {
        this.emit(
          source,
          rule,
          "Tool attribution conflicts with its parent message",
        );
        return undefined;
      }
      owner = parent;
    }
    if (event.type.endsWith("_START") || event.type.endsWith("_CHUNK"))
      owners.set(id, owner);
    // A tool result also establishes ownership of its result message.
    if (event.type === "TOOL_CALL_RESULT" && typeof e.messageId === "string")
      this.messages.set(e.messageId, owner);
    return owner === undefined
      ? event
      : ({ ...event, subagentRunId: owner } as Event);
  }
}
