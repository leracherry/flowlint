import type { Event } from "@ag-ui/core";
import type { Diagnostic, SourceEvent } from "./types";
type Family = "text" | "tool";
type Lane = string | undefined;
type Item = {
  family: Family;
  id: string;
  lane: Lane;
  attributes: Record<string, unknown>;
};
type Emit = (
  source: SourceEvent,
  rule: string,
  message: string,
  severity?: Diagnostic["severity"],
) => void;
const standAside = new Set([
  "RAW",
  "ACTIVITY_SNAPSHOT",
  "ACTIVITY_DELTA",
  "REASONING_ENCRYPTED_VALUE",
  "SUBAGENT_STARTED",
]);
const globalBoundary = new Set([
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "MESSAGES_SNAPSHOT",
]);
/** Stateful, bounded-to-identifiers expansion. No message/argument bodies are accumulated. */
export class ChunkNormalizer {
  private streams = new Map<Lane, Item>();
  private familyStreams: Record<Family, Map<Lane, Item>> = {
    text: new Map(),
    tool: new Map(),
  };
  private owners: Record<Family, Map<string, Set<Lane>>> = {
    text: new Map(),
    tool: new Map(),
  };
  private explicit: Record<Family, Map<Lane, Set<string>>> = {
    text: new Map(),
    tool: new Map(),
  };
  private boundaries = new Set<Lane>();
  private reasoningWarned = false;
  private reasoningOwners = new Map<string, Lane>();
  private reasoningStreams = new Set<Lane>();
  constructor(private emit: Emit) {}
  push(event: Event, source: SourceEvent, partialBoundary = false): Event[] {
    // Shapes have already been validated by the official schema.
    const e = event as Event & Record<string, unknown>;
    const output: Event[] = [];
    const close = (lane: Lane) => {
      const item = this.streams.get(lane);
      if (!item) return;
      output.push({
        type: item.family === "text" ? "TEXT_MESSAGE_END" : "TOOL_CALL_END",
        [item.family === "text" ? "messageId" : "toolCallId"]: item.id,
        ...(lane === undefined ? {} : { subagentRunId: lane }),
      } as Event);
      this.streams.delete(lane);
      this.familyStreams[item.family].delete(lane);
    };
    if (globalBoundary.has(event.type)) {
      for (const lane of this.streams.keys()) close(lane);
      this.reasoningStreams.clear();
      if (event.type !== "MESSAGES_SNAPSHOT") {
        this.owners = { text: new Map(), tool: new Map() };
        this.explicit = { text: new Map(), tool: new Map() };
        this.boundaries.clear();
        this.reasoningWarned = false;
        this.reasoningOwners.clear();
      }
      if (event.type === "MESSAGES_SNAPSHOT" || event.type === "RUN_STARTED") {
        const messages =
          event.type === "MESSAGES_SNAPSHOT"
            ? event.messages
            : (event.input?.messages ?? []);
        for (const message of messages) {
          const m = message as typeof message & {
            subagentRunId?: string;
            toolCalls?: { id: string }[];
          };
          if (m.role === "reasoning")
            this.reasoningOwners.set(m.id, m.subagentRunId);
          else if (m.role !== "activity")
            this.owners.text.set(m.id, new Set([m.subagentRunId]));
          for (const tool of m.toolCalls ?? [])
            this.owners.tool.set(tool.id, new Set([m.subagentRunId]));
        }
      }
      return [...output, event];
    }
    const family: Family | undefined = event.type.startsWith("TEXT_MESSAGE_")
      ? "text"
      : event.type.startsWith("TOOL_CALL_")
        ? "tool"
        : undefined;
    const chunk =
      event.type === "TEXT_MESSAGE_CHUNK" || event.type === "TOOL_CALL_CHUNK";
    const idKey = family === "tool" ? "toolCallId" : "messageId";
    const id =
      family && typeof e[idKey] === "string" ? (e[idKey] as string) : undefined;
    const tagged = typeof e.subagentRunId === "string";
    let lane = tagged ? (e.subagentRunId as string) : undefined;
    const ownership =
      family && id !== undefined ? this.owners[family].get(id) : undefined;
    const fail = (message: string) => this.emit(source, "FL011", message);
    if (ownership?.size) {
      if (tagged && !ownership.has(lane)) {
        fail(
          `${event.type} attribution conflicts with the item's opening owner`,
        );
        return [];
      }
      if (!tagged) {
        if (ownership.has(undefined)) lane = undefined;
        else if (ownership.size === 1) lane = ownership.values().next().value;
        else {
          fail(`${event.type} identifier targets more than one lane`);
          return [];
        }
      }
    } else if (family === "tool" && typeof e.parentMessageId === "string") {
      const parentOwners = this.owners.text.get(e.parentMessageId);
      if (parentOwners?.size === 1) {
        const parentLane = parentOwners.values().next().value;
        if (tagged && parentLane !== lane) {
          fail("Tool chunk attribution conflicts with its parent message");
          return [];
        }
        lane = parentLane;
      } else if (parentOwners && parentOwners.size > 1 && !tagged) {
        fail("Tool chunk parent message targets more than one lane");
        return [];
      }
    }
    if (chunk && !tagged && id === undefined) {
      const parent = this.streams.get(undefined);
      if (parent?.family === family) lane = undefined;
      else {
        const candidates = family
          ? this.familyStreams[family]
          : new Map<Lane, Item>();
        if (candidates.size > 1) {
          fail(`${event.type} continuation ambiguously targets multiple lanes`);
          return [];
        }
        if (candidates.size === 1) lane = candidates.keys().next().value;
      }
    }
    // Track only reasoning provenance to avoid closing a different owner's
    // supported stream. Reasoning content/lifecycle validation remains deferred.
    if (event.type.startsWith("REASONING_MESSAGE_") && !tagged) {
      if (
        typeof e.messageId === "string" &&
        this.reasoningOwners.has(e.messageId)
      )
        lane = this.reasoningOwners.get(e.messageId);
      else if (
        event.type === "REASONING_MESSAGE_CHUNK" &&
        e.messageId === undefined
      ) {
        if (this.reasoningStreams.has(undefined)) lane = undefined;
        else if (this.reasoningStreams.size === 1)
          lane = this.reasoningStreams.values().next().value;
        else {
          if (!this.reasoningWarned)
            this.emit(
              source,
              "COVERAGE_REASONING",
              "Reasoning chunks are schema-validated but not normalized or lifecycle-checked",
              "warning",
            );
          this.reasoningWarned = true;
          return [event];
        }
      }
    }
    if (event.type === "SUBAGENT_STARTED") this.boundaries.add(lane);
    if (event.type === "SUBAGENT_FINISHED" || event.type === "SUBAGENT_ERROR") {
      close(lane);
      this.reasoningStreams.delete(lane);
      this.boundaries.add(lane);
      return [...output, event];
    }
    if (event.type === "REASONING_MESSAGE_CHUNK" && !this.reasoningWarned) {
      this.emit(
        source,
        "COVERAGE_REASONING",
        "Reasoning chunks are schema-validated but not normalized or lifecycle-checked",
        "warning",
      );
      this.reasoningWarned = true;
    }
    if (chunk && family) {
      this.reasoningStreams.delete(lane);
      let item = this.streams.get(lane);
      if (
        item &&
        (item.family !== family || (id !== undefined && id !== item.id))
      ) {
        close(lane);
        item = undefined;
        this.boundaries.add(lane);
      }
      if (item) {
        const fields =
          family === "text"
            ? ["role", "name"]
            : ["toolCallName", "parentMessageId"];
        for (const field of fields)
          if (e[field] !== undefined && e[field] !== item.attributes[field]) {
            fail(`${event.type} continuation conflicts with opening ${field}`);
            return output;
          }
      } else {
        if (
          id === undefined ||
          (family === "tool" && e.toolCallName === undefined)
        ) {
          this.emit(
            source,
            "FL010",
            family === "text"
              ? "Opening TEXT_MESSAGE_CHUNK requires messageId"
              : "Opening TOOL_CALL_CHUNK requires toolCallId and toolCallName",
            partialBoundary && !this.boundaries.has(lane) ? "warning" : "error",
          );
          return output;
        }
        if (this.explicit[family].get(lane)?.has(id)) {
          fail(
            `${event.type} mixes chunk and explicit forms within an open item`,
          );
          return output;
        }
        item = {
          family,
          id,
          lane,
          attributes:
            family === "text"
              ? { role: e.role ?? "assistant", name: e.name }
              : {
                  toolCallName: e.toolCallName,
                  parentMessageId: e.parentMessageId,
                },
        };
        this.streams.set(lane, item);
        this.familyStreams[family].set(lane, item);
        this.remember(family, id, lane);
        output.push({
          ...this.common(e, lane),
          type: family === "text" ? "TEXT_MESSAGE_START" : "TOOL_CALL_START",
          [idKey]: id,
          ...item.attributes,
        } as Event);
      }
      if (e.delta !== undefined || e.metadata !== undefined)
        output.push({
          ...this.common(e, lane),
          type: family === "text" ? "TEXT_MESSAGE_CONTENT" : "TOOL_CALL_ARGS",
          [idKey]: item.id,
          delta: e.delta ?? "",
        } as Event);
      return output;
    }
    if (!standAside.has(event.type)) {
      this.reasoningStreams.delete(lane);
      const item = this.streams.get(lane);
      if (
        item &&
        family === item.family &&
        id === item.id &&
        event.type !== "TOOL_CALL_RESULT"
      )
        fail(
          `${event.type} mixes explicit and chunk forms within an open item`,
        );
      close(lane);
      this.boundaries.add(lane);
    }
    if (family && id !== undefined) {
      if (event.type.endsWith("_START")) {
        this.remember(family, id, lane);
        const open = this.explicit[family].get(lane) ?? new Set<string>();
        open.add(id);
        this.explicit[family].set(lane, open);
      } else if (event.type.endsWith("_END"))
        this.explicit[family].get(lane)?.delete(id);
    }
    if (
      event.type === "REASONING_MESSAGE_START" ||
      event.type === "REASONING_MESSAGE_CHUNK"
    ) {
      if (typeof e.messageId === "string")
        this.reasoningOwners.set(e.messageId, lane);
      if (event.type === "REASONING_MESSAGE_CHUNK")
        this.reasoningStreams.add(lane);
    }
    output.push(event);
    return output;
  }
  private remember(family: Family, id: string, lane: Lane) {
    const owners = this.owners[family].get(id) ?? new Set<Lane>();
    owners.add(lane);
    this.owners[family].set(id, owners);
  }
  private common(event: Record<string, unknown>, lane: Lane) {
    return {
      ...(lane === undefined ? {} : { subagentRunId: lane }),
      ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
      ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
    };
  }
}
