/** Minimal run-local state. Message bodies and argument fragments are never retained. */
export function createItemState() {
  return {
    open: new Set<string>(),
    closed: new Set<string>(),
  };
}
export function createState() {
  return {
    status: "initial" as
      "initial" | "excerpt" | "active" | "finished" | "errored",
    run: undefined as { threadId: string; runId: string } | undefined,
    messages: createItemState(),
    tools: createItemState(),
    seenRuns: new Map<string, Set<string>>(),
    subagents: new Set<string>(),
    closedSubagents: new Set<string>(),
    attributed: new Set<string>(),
  };
}
