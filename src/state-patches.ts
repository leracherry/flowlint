import type { Event } from "@ag-ui/core";
import type { Diagnostic, SourceEvent } from "./types";
import { MAX_INPUT_BYTES } from "./parse";
type Emit = (
  record: SourceEvent,
  rule: string,
  message: string,
  severity?: Diagnostic["severity"],
) => void;
type Baseline = { known: boolean; value?: unknown };
class PatchError extends Error {}
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const tokens = (pointer: string): string[] => {
  if (pointer === "") return [];
  if (!pointer.startsWith("/") || /~(?:[^01]|$)/.test(pointer))
    throw new PatchError("invalid JSON pointer");
  return pointer
    .slice(1)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
};
function index(key: string, size: number, append = false): number {
  if (append && key === "-") return size;
  if (!/^(0|[1-9][0-9]*)$/.test(key))
    throw new PatchError("invalid array index");
  const n = Number(key);
  if (!Number.isSafeInteger(n) || n > size || (!append && n === size))
    throw new PatchError("array index out of bounds");
  return n;
}
function get(value: unknown, path: string[]): unknown {
  for (const key of path) {
    if (Array.isArray(value)) value = value[index(key, value.length)];
    else if (value !== null && typeof value === "object" && own(value, key))
      value = (value as Record<string, unknown>)[key];
    else throw new PatchError("path does not exist");
  }
  if (value === undefined) throw new PatchError("path does not exist");
  return value;
}
function write(
  value: unknown,
  path: string[],
  op: "add" | "remove" | "replace",
  data?: unknown,
): unknown {
  if (!path.length) {
    if (op !== "add") get(value, []);
    return op === "remove" ? undefined : data;
  }
  const parent = get(value, path.slice(0, -1));
  const key = path[path.length - 1]!;
  if (Array.isArray(parent)) {
    const i = index(key, parent.length, op === "add");
    if (op === "add") parent.splice(i, 0, data);
    else if (op === "remove") parent.splice(i, 1);
    else parent[i] = data;
  } else if (parent !== null && typeof parent === "object") {
    if (op !== "add" && !own(parent, key))
      throw new PatchError("path does not exist");
    if (op === "remove") delete (parent as Record<string, unknown>)[key];
    else
      Object.defineProperty(parent, key, {
        value: data,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  } else throw new PatchError("path parent is not a container");
  return value;
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        own(b, key) &&
        equal(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
    )
  );
}
const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value) ?? "");

/** State is shared by all producers and persists per thread. No values enter diagnostics. */
export class StatePatches {
  private threads = new Map<string, Baseline>();
  private current: Baseline = { known: false };
  private work = 0;
  private retained = 0;
  private thread: string | undefined;
  constructor(private emit: Emit) {}
  observe(event: Event, record: SourceEvent) {
    if (event.type === "RUN_STARTED") {
      if (this.thread === undefined && this.current.known)
        this.retained -= bytes(this.current.value);
      this.thread = event.threadId;
      this.current = this.threads.get(event.threadId) ?? { known: false };
      this.threads.set(event.threadId, this.current);
      if (event.input)
        this.replace(
          event.input.state === undefined ? {} : event.input.state,
          record,
        );
    } else if (event.type === "STATE_SNAPSHOT")
      this.replace(event.snapshot, record);
    else if (event.type === "STATE_DELTA") {
      if (!event.delta.length) return;
      if (!this.current.known) {
        this.emit(
          record,
          "STATE_BASELINE",
          "State patch cannot be checked without a recorded input state or snapshot",
          "warning",
        );
        return;
      }
      if (this.work > MAX_INPUT_BYTES * 20) {
        this.invalidate(record);
        return;
      }
      let operation = 0;
      try {
        let value = structuredClone(this.current.value);
        for (const patch of event.delta) {
          operation++;
          const path = tokens(patch.path);
          switch (patch.op) {
            case "add":
              value = write(value, path, "add", structuredClone(patch.value));
              break;
            case "remove":
              value = write(value, path, "remove");
              break;
            case "replace":
              value = write(
                value,
                path,
                "replace",
                structuredClone(patch.value),
              );
              break;
            case "test":
              if (!equal(get(value, path), patch.value))
                throw new PatchError("test did not match");
              break;
            case "copy":
              value = write(
                value,
                path,
                "add",
                structuredClone(get(value, tokens(patch.from))),
              );
              break;
            case "move": {
              const from = tokens(patch.from);
              if (
                path.length > from.length &&
                from.every((p, i) => p === path[i])
              )
                throw new PatchError("cannot move a value into its descendant");
              const moved = get(value, from);
              value = write(value, from, "remove");
              value = write(value, path, "add", moved);
              break;
            }
          }
          const size = bytes(value);
          this.work += size;
          if (size > MAX_INPUT_BYTES || this.work > MAX_INPUT_BYTES * 20) {
            this.invalidate(record);
            return;
          }
        }
        this.replace(value, record);
      } catch (error) {
        this.emit(
          record,
          "STATE_PATCH",
          `State patch operation ${operation} could not apply: ${error instanceof PatchError ? error.message : "unsupported state value"}; prior state retained`,
          "warning",
        );
      }
    }
  }
  private replace(value: unknown, record: SourceEvent) {
    const size = bytes(value);
    const previous = this.current.known ? bytes(this.current.value) : 0;
    if (this.retained - previous + size > MAX_INPUT_BYTES) {
      this.invalidate(record);
      return;
    }
    this.retained += size - previous;
    this.current.value = structuredClone(value);
    this.current.known = true;
  }
  private invalidate(record: SourceEvent) {
    if (this.current.known) this.retained -= bytes(this.current.value);
    this.current.known = false;
    this.current.value = undefined;
    this.emit(
      record,
      "STATE_LIMIT",
      "State validation resource limit reached; this baseline is no longer verified",
      "warning",
    );
  }
}
