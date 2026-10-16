import { createHash } from "node:crypto";
import type { Event, Message } from "@ag-ui/core";
import type { SourceEvent } from "./types";
import type { Emit } from "./state-patches";

type Item = {
  attributes: Record<string, string | undefined>;
  encrypted?: string;
  parent?: string;
};
type History = {
  messages: Map<string, Item>;
  tools: Map<string, Item>;
  children: Map<string, Set<string>>;
};
const history = (): History => ({
  messages: new Map(),
  tools: new Map(),
  children: new Map(),
});
// Retain only a digest for equality checks, never the opaque artifact itself.
const digest = (value: string | undefined) =>
  value === undefined
    ? undefined
    : createHash("sha256").update(value, "utf16le").digest("hex");
export class Conversation {
  private threads = new Map<string, History>();
  private current = history();
  private openMessages = new Set<string>();
  private openTools = new Set<string>();
  constructor(private emit: Emit) {}
  private removeMessage(id: string) {
    this.current.messages.delete(id);
    for (const key of this.current.children.get(id) ?? [])
      this.current.tools.delete(key);
    this.current.children.delete(id);
  }
  private storeTool(id: string, item: Item) {
    const previous = this.current.tools.get(id);
    if (previous?.parent !== undefined)
      this.current.children.get(previous.parent)?.delete(id);
    this.current.tools.set(id, item);
    if (item.parent !== undefined) {
      const children =
        this.current.children.get(item.parent) ?? new Set<string>();
      children.add(id);
      this.current.children.set(item.parent, children);
    }
  }
  private load(messages: Message[]) {
    for (const m of messages) {
      this.removeMessage(m.id);
      this.current.messages.set(m.id, {
        attributes: {
          role: m.role,
          name: "name" in m ? m.name : undefined,
          owner: m.subagentRunId,
        },
        encrypted: "encryptedValue" in m ? digest(m.encryptedValue) : undefined,
      });
      if (m.role === "assistant")
        for (const t of m.toolCalls ?? [])
          this.storeTool(t.id, {
            attributes: {
              toolCallName: t.function.name,
              parentMessageId: m.id,
              owner: m.subagentRunId,
            },
            encrypted: digest(t.encryptedValue),
            parent: m.id,
          });
    }
  }
  observe(event: Event, record: SourceEvent) {
    if (event.type === "RUN_STARTED") {
      this.current = this.threads.get(event.threadId) ?? history();
      this.threads.set(event.threadId, this.current);
      this.openMessages.clear();
      this.openTools.clear();
      if (event.input) {
        const incoming = history();
        for (const m of event.input.messages) {
          incoming.messages.set(m.id, {
            attributes: {},
            encrypted:
              "encryptedValue" in m ? digest(m.encryptedValue) : undefined,
          });
          if (m.role === "assistant")
            for (const t of m.toolCalls ?? [])
              incoming.tools.set(t.id, {
                attributes: {},
                encrypted: digest(t.encryptedValue),
              });
        }
        for (const kind of ["messages", "tools"] as const)
          for (const [id, prior] of this.current[kind]) {
            if (
              prior.encrypted !== undefined &&
              incoming[kind].get(id)?.encrypted !== prior.encrypted
            )
              this.emit(
                record,
                "ENCRYPTED_PRESERVATION",
                `Recorded run input omits or changes a retained encrypted ${kind === "messages" ? "message" : "tool-call"} artifact`,
                "warning",
              );
          }
        // Input is authoritative for included IDs. Client-only messages can be absent.
        this.load(event.input.messages);
      }
      return;
    }
    if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
      this.openMessages.clear();
      this.openTools.clear();
      return;
    }
    if (event.type === "MESSAGES_SNAPSHOT") {
      const ids = new Set(event.messages.map((m) => m.id));
      const roles = new Set(event.messages.map((m) => m.role));
      for (const [id, m] of this.current.messages) {
        const role = m.attributes.role;
        if (
          !ids.has(id) &&
          !((role === "activity" || role === "reasoning") && !roles.has(role))
        )
          this.removeMessage(id);
      }
      // Calls without an explicit parent still belong to producer history.
      for (const [id, tool] of this.current.tools)
        if (tool.parent === undefined) this.current.tools.delete(id);
      this.load(event.messages);
      return;
    }
    if (event.type === "ACTIVITY_SNAPSHOT") {
      if (
        event.replace !== false ||
        this.current.messages.get(event.messageId)?.attributes.role !==
          "activity"
      ) {
        this.removeMessage(event.messageId);
        this.current.messages.set(event.messageId, {
          attributes: { role: "activity", owner: event.subagentRunId },
        });
      }
      return;
    }
    if (event.type === "REASONING_ENCRYPTED_VALUE") {
      const target = (
        event.subtype === "message" ? this.current.messages : this.current.tools
      ).get(event.entityId);
      if (!target || target.attributes.role === "activity")
        this.emit(
          record,
          "ENCRYPTED_TARGET",
          "Encrypted artifact has no recorded compatible target; storage cannot be verified",
          "warning",
        );
      else target.encrypted = digest(event.encryptedValue);
      return;
    }
    if (event.type === "TOOL_CALL_RESULT") {
      this.removeMessage(event.messageId);
      this.current.messages.set(event.messageId, {
        attributes: { role: "tool", owner: event.subagentRunId },
      });
      return;
    }
    if (
      event.type === "TEXT_MESSAGE_END" ||
      event.type === "REASONING_MESSAGE_END"
    )
      this.openMessages.delete(event.messageId);
    if (event.type === "TOOL_CALL_END") this.openTools.delete(event.toolCallId);
    if (
      event.type !== "TEXT_MESSAGE_START" &&
      event.type !== "REASONING_MESSAGE_START" &&
      event.type !== "TOOL_CALL_START"
    )
      return;
    const tool = event.type === "TOOL_CALL_START";
    const id = tool ? event.toolCallId : event.messageId;
    const items = tool ? this.current.tools : this.current.messages;
    const open = tool ? this.openTools : this.openMessages;
    const attributes: Item["attributes"] = tool
      ? {
          toolCallName: event.toolCallName,
          parentMessageId: event.parentMessageId,
          owner: event.subagentRunId,
        }
      : {
          role:
            event.type === "TEXT_MESSAGE_START"
              ? (event.role ?? "assistant")
              : "reasoning",
          name: event.type === "TEXT_MESSAGE_START" ? event.name : undefined,
          owner: event.subagentRunId,
        };
    const prior = items.get(id);
    if (prior && !open.has(id)) {
      const fields = Object.keys(attributes).filter(
        (key) => attributes[key] !== prior.attributes[key],
      );
      if (fields.length)
        this.emit(
          record,
          "ITEM_REOPEN",
          `Reopened ${tool ? "tool call" : "message"} conflicts with established ${fields.join(", ")}`,
        );
    }
    if (!prior) {
      if (tool)
        this.storeTool(id, { attributes, parent: event.parentMessageId });
      else items.set(id, { attributes });
    }
    open.add(id);
  }
}
