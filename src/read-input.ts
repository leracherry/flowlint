import { createReadStream } from "node:fs";
import { TraceInputError, MAX_INPUT_BYTES } from "./parse";
export async function readInput(file: string): Promise<string> {
  const stream = file === "-" ? process.stdin : createReadStream(file);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_INPUT_BYTES) {
      stream.destroy();
      throw new TraceInputError(
        "PARSE_LIMIT",
        "Trace exceeds the 10 MiB input limit",
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
