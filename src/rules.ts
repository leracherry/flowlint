/** Rule metadata. Severity depends on capture boundaries and available evidence. */
export const RULES = [
  {
    id: "FL001",
    description: "Stream starts without RUN_STARTED or RUN_ERROR",
  },
  {
    id: "FL002",
    description:
      "Explicit text content/end references a message that is not open",
  },
  {
    id: "FL003",
    description: "Explicitly opened text message remains open at RUN_FINISHED",
  },
  {
    id: "FL004",
    description: "Tool call starts while its ID is already open",
  },
  {
    id: "FL005",
    description:
      "Explicit tool arguments/end references a tool call that is not open",
  },
  {
    id: "FL006",
    description: "New run starts while the prior run is active",
  },
  {
    id: "FL007",
    description: "A run ID is reused for another run on the same thread",
  },
  {
    id: "FL008",
    description: "Text message starts while its ID is already open",
  },
  {
    id: "FL009",
    description: "Explicitly opened tool call remains open at RUN_FINISHED",
  },
  {
    id: "FL010",
    description: "Opening text/tool/reasoning chunk omits required fields",
  },
  {
    id: "FL011",
    description:
      "Text/tool ownership conflicts; chunk conflicts, mixed forms, or ambiguous lanes",
  },
  {
    id: "FL012",
    description: "Capture ends without a terminal event or with open items",
  },
  {
    id: "RUN_TRANSITION",
    description:
      "Event follows a closed run illegally, or finish has no observed start",
  },
  {
    id: "RUN_IDENTITY",
    description: "Finish identifiers differ from the active run",
  },
  {
    id: "SUBAGENT_START",
    description:
      "Duplicate/reused invocation ID or announcement after attributed output",
  },
  {
    id: "SUBAGENT_END",
    description: "Subagent terminal without an active invocation",
  },
  {
    id: "SUBAGENT_PARENT",
    description: "Nested invocation names an unannounced parent",
  },
  {
    id: "SUBAGENT_OPEN",
    description: "Run finishes with an announced invocation still active",
  },
  {
    id: "ATTRIBUTION",
    description:
      "Reasoning/activity ownership or step attribution disagrees with its opener",
  },
  {
    id: "REASONING_SPAN_START",
    description: "Reasoning span starts while its ID is open",
  },
  {
    id: "REASONING_SPAN_END",
    description: "Reasoning span ends without an open span",
  },
  {
    id: "REASONING_SPAN_OPEN",
    description: "Reasoning span remains open at run finish",
  },
  {
    id: "REASONING_MESSAGE_START",
    description: "Reasoning message starts while its ID is open",
  },
  {
    id: "REASONING_MESSAGE_MISSING",
    description: "Reasoning content/end refers to an unopened message",
  },
  {
    id: "REASONING_MESSAGE_OPEN",
    description: "Reasoning message remains open at run finish",
  },
  {
    id: "STEP_START",
    description: "Step starts while the same owner's step name is open",
  },
  {
    id: "STEP_END",
    description: "Step finishes without an open step for that owner",
  },
  {
    id: "STEP_OPEN",
    description: "Step remains open at run finish",
  },
  {
    id: "STATE_PATCH",
    description: "Well-formed patch cannot apply; warn and retain prior state",
  },
  {
    id: "STATE_BASELINE",
    description: "No recorded state baseline; patch applicability is unknown",
  },
  {
    id: "STATE_LIMIT",
    description: "State validation exceeded its resource budget",
  },
  {
    id: "ACTIVITY_PATCH",
    description: "Activity patch cannot apply; warn and retain prior content",
  },
  {
    id: "ACTIVITY_BASELINE",
    description: "Activity baseline missing or no longer verified",
  },
  {
    id: "ACTIVITY_LIMIT",
    description: "Activity validation exceeded its shared resource budget",
  },
  {
    id: "ACTIVITY_CONTENT",
    description: "Patched activity content would not be an object",
  },
  {
    id: "ITEM_REOPEN",
    description:
      "Reopened message/tool attributes disagree with the established item",
  },
  {
    id: "ENCRYPTED_TARGET",
    description: "No recorded compatible message or tool target; warning",
  },
  {
    id: "ENCRYPTED_PRESERVATION",
    description:
      "Later recorded input omits or changes a retained artifact; warning",
  },
  {
    id: "ENCRYPTED_SUBTYPE",
    description: "Unknown string subtype; warn and skip the encrypted event",
  },
] as const;

function ruleIds<T extends readonly { id: string }[]>(rules: T) {
  return rules.map((rule) => rule.id) as { [K in keyof T]: T[K]["id"] };
}

export const SUPPORTED_RULES = ruleIds(RULES);
