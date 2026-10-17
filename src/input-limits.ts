/** Bounds recursive dependencies and caller-provided graphs before schema parsing. */
export const MAX_JSON_DEPTH = 256;
export const MAX_EVENT_NODES = 100_000;
export function eventWithinLimits(value: unknown): boolean {
  const ancestors = new Set<object>();
  const stack: { value: unknown; depth: number; leave?: boolean }[] = [
    { value, depth: 1 },
  ];
  let nodes = 1;
  let stringBytes = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.leave) {
      ancestors.delete(entry.value as object);
      continue;
    }
    if (typeof entry.value === "string")
      stringBytes += Buffer.byteLength(entry.value);
    if (stringBytes > 10 * 1024 * 1024) return false;
    if (entry.value === null || typeof entry.value !== "object") continue;
    if (entry.depth > MAX_JSON_DEPTH) return false;
    if (ancestors.has(entry.value)) return false;
    ancestors.add(entry.value);
    stack.push({ ...entry, leave: true });
    if (Array.isArray(entry.value) && entry.value.length > MAX_EVENT_NODES)
      return false;
    const keys = Object.keys(entry.value);
    nodes += Array.isArray(entry.value)
      ? Math.max(keys.length, entry.value.length)
      : keys.length;
    if (nodes > MAX_EVENT_NODES) return false;
    for (const key of keys) {
      stringBytes += Buffer.byteLength(key);
      if (stringBytes > 10 * 1024 * 1024) return false;
      stack.push({
        value: (entry.value as Record<string, unknown>)[key],
        depth: entry.depth + 1,
      });
    }
  }
  return true;
}
/** Scan JSON nesting before recursive parsing; braces inside strings are data. */
export function excessiveDepthOffset(text: string): number | undefined {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") {
      if (++depth > MAX_JSON_DEPTH) return i;
    } else if (c === "}" || c === "]") depth = Math.max(0, depth - 1);
  }
  return undefined;
}
