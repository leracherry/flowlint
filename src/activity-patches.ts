import { EventType, type Event } from "@ag-ui/core";
import type { SourceEvent } from "./types";
import { StatePatches, type Emit, type PatchBudget } from "./state-patches";

type Activity = { patches: StatePatches; owner?: string };
/** Activity content and ownership persist per conversation, with one shared budget. */
export class ActivityPatches {
  private threads = new Map<string, Map<string, Activity>>();
  private current = new Map<string, Activity>();
  private thread?: string;
  private budget: PatchBudget = { work: 0, retained: 0 };
  constructor(private emit: Emit) {}
  private remove(id: string) {
    this.current.get(id)?.patches.forget();
    this.current.delete(id);
  }
  private snapshot(
    id: string,
    content: Record<string, unknown>,
    owner: string | undefined,
    record: SourceEvent,
  ) {
    this.remove(id);
    const patches = new StatePatches(this.emit, "ACTIVITY", this.budget);
    patches.observe(
      { type: EventType.STATE_SNAPSHOT, snapshot: content },
      record,
    );
    this.current.set(id, { patches, owner });
  }
  observe(event: Event, record: SourceEvent): Event | undefined {
    if (event.type === "RUN_STARTED") {
      if (this.thread === undefined)
        for (const id of this.current.keys()) this.remove(id);
      this.thread = event.threadId;
      this.current = this.threads.get(event.threadId) ?? new Map();
      this.threads.set(event.threadId, this.current);
    }
    if (event.type === "MESSAGES_SNAPSHOT" || event.type === "RUN_STARTED") {
      const messages =
        event.type === "MESSAGES_SNAPSHOT"
          ? event.messages
          : (event.input?.messages ?? []);
      if (
        event.type === "MESSAGES_SNAPSHOT" &&
        messages.some((m) => m.role === "activity")
      ) {
        const ids = new Set(
          messages.filter((m) => m.role === "activity").map((m) => m.id),
        );
        for (const id of this.current.keys()) if (!ids.has(id)) this.remove(id);
      }
      for (const m of messages) {
        if (m.role === "activity")
          this.snapshot(m.id, m.content, m.subagentRunId, record);
        else this.remove(m.id);
      }
    }
    if (event.type !== "ACTIVITY_SNAPSHOT" && event.type !== "ACTIVITY_DELTA")
      return event;
    const prior = this.current.get(event.messageId);
    if (
      event.type === "ACTIVITY_SNAPSHOT" &&
      (!prior || event.replace !== false)
    ) {
      this.snapshot(
        event.messageId,
        event.content,
        event.subagentRunId,
        record,
      );
      return event;
    }
    if (
      prior &&
      event.subagentRunId !== undefined &&
      event.subagentRunId !== prior.owner
    ) {
      this.emit(
        record,
        "ATTRIBUTION",
        "Activity attribution conflicts with its established owner",
      );
      return undefined;
    }
    if (event.type === "ACTIVITY_DELTA") {
      if (!prior)
        this.emit(
          record,
          "ACTIVITY_BASELINE",
          "Activity delta has no recorded activity snapshot; update skipped",
          "warning",
        );
      else
        prior.patches.observe(
          { type: EventType.STATE_DELTA, delta: event.patch },
          record,
        );
    }
    return prior?.owner === undefined
      ? event
      : { ...event, subagentRunId: prior.owner };
  }
}
