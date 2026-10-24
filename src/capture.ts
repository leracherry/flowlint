import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_INPUT_BYTES } from "./parse";

export type CaptureManifest = {
  schemaVersion: 1;
  captureId: string;
  file: string;
  format: "sse";
  producer: { name: string; version: string };
  source: "http-response-body";
  startedAt: string;
  outcome:
    "complete" | "cancelled" | "transport-error" | "fetch-error" | "skipped";
  bytesObserved: number;
  bytesStored: number;
  truncated: boolean;
  sha256: string;
  transformations: [];
  writeError?: "CAPTURE_WRITE";
};
export type HttpCaptureOptions = {
  directory: string;
  producer: { name: string; version: string };
  maxBytes?: number;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
};

/** Capture SSE bytes on consumer reads, without a second stream consumer. */
export function createHttpCapture(options: HttpCaptureOptions): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  flush: () => Promise<CaptureManifest[]>;
} {
  const maxBytes = options.maxBytes ?? MAX_INPUT_BYTES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_INPUT_BYTES
  )
    throw new RangeError(
      "Capture maxBytes must be between 1 and MAX_INPUT_BYTES",
    );
  const directory = path.resolve(options.directory);
  const producer = { ...options.producer };
  const fetchResponse = options.fetch ?? globalThis.fetch;
  const captures: Promise<CaptureManifest>[] = [];
  return {
    async fetch(url, init) {
      const captureId = randomUUID();
      const startedAt = new Date().toISOString();
      const chunks: Buffer[] = [];
      let bytesObserved = 0;
      let bytesStored = 0;
      let finalized = false;
      let resolveCapture!: (manifest: CaptureManifest) => void;
      captures.push(
        new Promise((resolve) => {
          resolveCapture = resolve;
        }),
      );
      const finish = (outcome: CaptureManifest["outcome"]) => {
        if (finalized) return;
        finalized = true;
        const body = Buffer.concat(chunks);
        chunks.length = 0;
        const manifest: CaptureManifest = {
          schemaVersion: 1,
          captureId,
          file: `${captureId}.sse`,
          format: "sse",
          producer,
          source: "http-response-body",
          startedAt,
          outcome,
          bytesObserved,
          bytesStored,
          truncated: bytesObserved > bytesStored,
          sha256: createHash("sha256").update(body).digest("hex"),
          transformations: [],
        };
        // Persistence never delays delivery of EOF, cancellation, or transport errors.
        void (async () => {
          try {
            if (outcome !== "skipped") {
              await mkdir(directory, { recursive: true, mode: 0o700 });
              await writeFile(path.join(directory, manifest.file), body, {
                flag: "wx",
                mode: 0o600,
              });
              await writeFile(
                path.join(directory, `${captureId}.manifest.json`),
                JSON.stringify(manifest, null, 2) + "\n",
                { flag: "wx", mode: 0o600 },
              );
            }
            resolveCapture(manifest);
          } catch {
            resolveCapture({ ...manifest, writeError: "CAPTURE_WRITE" });
          }
        })();
      };
      let response: Response;
      try {
        response = await fetchResponse(url, init);
      } catch (error) {
        finish("fetch-error");
        throw error;
      }
      if (
        !response.body ||
        response.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== "text/event-stream"
      ) {
        finish("skipped");
        return response;
      }
      let reader: ReadableStreamDefaultReader<Uint8Array>;
      try {
        reader = response.body.getReader();
      } catch (error) {
        finish("transport-error");
        throw error;
      }
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) {
                finish("complete");
                reader.releaseLock();
                controller.close();
                return;
              }
              bytesObserved += value.byteLength;
              const remaining = maxBytes - bytesStored;
              if (remaining > 0) {
                const copy = Buffer.from(value.subarray(0, remaining));
                chunks.push(copy);
                bytesStored += copy.byteLength;
              }
              controller.enqueue(value);
            } catch (error) {
              finish("transport-error");
              reader.releaseLock();
              controller.error(error);
            }
          },
          async cancel(reason) {
            finish("cancelled");
            try {
              await reader.cancel(reason);
            } finally {
              reader.releaseLock();
            }
          },
        },
        { highWaterMark: 0 },
      );
      const captured = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      // HttpAgent consumes headers/status/body; preserve fetch metadata for callers too.
      for (const key of ["url", "redirected", "type"] as const)
        Object.defineProperty(captured, key, { value: response[key] });
      return captured;
    },
    flush() {
      return Promise.all([...captures]);
    },
  };
}
