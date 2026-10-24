import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import {
  createHttpCapture,
  lintEvents,
  parseTrace,
  MAX_INPUT_BYTES,
} from "../src/index";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "flowlint capture "));
  roots.push(root);
  return { directory: root, producer: { name: "test-server", version: "1" } };
}
const events = [
  { type: "RUN_STARTED", threadId: "t", runId: "r" },
  { type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" },
  { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "hello 🌱" },
  { type: "TEXT_MESSAGE_END", messageId: "m" },
  { type: "RUN_FINISHED", threadId: "t", runId: "r" },
];
const wire =
  ": heartbeat\r\n\r\n" +
  events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("");
const response = (body: BodyInit | ReadableStream<Uint8Array> = wire) =>
  new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
it("captures exact bytes and source hashes across arbitrary UTF-8 chunks", async () => {
  const options = await setup();
  const data = Buffer.from(wire);
  let offset = 0;
  const source = new ReadableStream<Uint8Array>({
    pull(c) {
      if (offset === data.length) c.close();
      else c.enqueue(data.subarray(offset, ++offset));
    },
  });
  const capture = createHttpCapture({
    ...options,
    fetch: async () => response(source),
  });
  expect(await (await capture.fetch("https://example.com")).text()).toBe(wire);
  const [manifest] = await capture.flush();
  expect(manifest).toMatchObject({
    outcome: "complete",
    truncated: false,
    bytesStored: data.length,
    bytesObserved: data.length,
    transformations: [],
  });
  expect(manifest!.sha256).toBe(
    createHash("sha256").update(data).digest("hex"),
  );
  expect(await readFile(path.join(options.directory, manifest!.file))).toEqual(
    data,
  );
  expect(
    JSON.parse(
      await readFile(
        path.join(options.directory, `${manifest!.captureId}.manifest.json`),
        "utf8",
      ),
    ),
  ).toEqual(manifest);
});
it("works with the real HttpAgent client and preserves emitted events", async () => {
  const options = await setup();
  const fetchResponse = vi.fn(async () =>
    response(wire.replaceAll("\r\n", "\n")),
  );
  const capture = createHttpCapture({ ...options, fetch: fetchResponse });
  const seen: unknown[] = [];
  const agent = new HttpAgent({
    url: "https://example.com/agent",
    threadId: "t",
    fetch: capture.fetch,
  });
  agent.subscribe({
    onEvent: ({ event }) => {
      seen.push(event);
    },
  });
  try {
    await agent.runAgent({ runId: "r" });
  } finally {
    await capture.flush();
  }
  const [manifest] = await capture.flush();
  const records = parseTrace(
    await readFile(path.join(options.directory, manifest!.file), "utf8"),
  );
  expect(records.map((r) => r.event)).toEqual(events);
  expect(seen).toEqual(events);
  expect(lintEvents(records).valid).toBe(true);
  expect(agent.messages).toMatchObject([{ id: "m", content: "hello 🌱" }]);
});
it("does not read ahead when the caller has not consumed the response", async () => {
  const options = await setup();
  const pull = vi.fn((c: ReadableStreamDefaultController<Uint8Array>) =>
    c.enqueue(new Uint8Array([1])),
  );
  const capture = createHttpCapture({
    ...options,
    fetch: async () =>
      response(new ReadableStream({ pull }, { highWaterMark: 0 })),
  });
  const result = await capture.fetch("https://example.com");
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(pull).not.toHaveBeenCalled();
  await result.body!.cancel();
  expect((await capture.flush())[0]!.outcome).toBe("cancelled");
});
it("forwards cancellation and records only consumed bytes", async () => {
  const options = await setup();
  const cancel = vi.fn();
  const capture = createHttpCapture({
    ...options,
    fetch: async () =>
      response(
        new ReadableStream(
          {
            pull(c) {
              c.enqueue(Buffer.from("data: "));
            },
            cancel,
          },
          { highWaterMark: 0 },
        ),
      ),
  });
  const reader = (await capture.fetch("https://example.com")).body!.getReader();
  await reader.read();
  await reader.cancel("caller stopped");
  expect(cancel).toHaveBeenCalledWith("caller stopped");
  const [manifest] = await capture.flush();
  expect(manifest).toMatchObject({
    outcome: "cancelled",
    bytesObserved: 6,
    bytesStored: 6,
  });
});
it("preserves the original transport error without including its contents", async () => {
  const options = await setup();
  const error = new Error("PRIVATE_TRANSPORT_DETAILS");
  let first = true;
  const capture = createHttpCapture({
    ...options,
    fetch: async () =>
      response(
        new ReadableStream(
          {
            pull(c) {
              if (first) {
                first = false;
                c.enqueue(Buffer.from("data: "));
              } else c.error(error);
            },
          },
          { highWaterMark: 0 },
        ),
      ),
  });
  await expect(
    (await capture.fetch("https://example.com")).text(),
  ).rejects.toBe(error);
  const [manifest] = await capture.flush();
  expect(manifest).toMatchObject({
    outcome: "transport-error",
    bytesStored: 6,
  });
  expect(JSON.stringify(manifest)).not.toContain("PRIVATE_TRANSPORT_DETAILS");
});
it("records protocol RUN_ERROR as an intact body rather than a transport failure", async () => {
  const options = await setup();
  const body = 'data: {"type":"RUN_ERROR","message":"failed"}\n\n';
  const capture = createHttpCapture({
    ...options,
    fetch: async () => response(body),
  });
  await (await capture.fetch("https://example.com")).text();
  const [manifest] = await capture.flush();
  expect(manifest!.outcome).toBe("complete");
  expect(
    lintEvents(
      parseTrace(
        await readFile(path.join(options.directory, manifest!.file), "utf8"),
      ),
    ).valid,
  ).toBe(true);
});
it("caps stored bytes without truncating the client's response", async () => {
  const options = await setup();
  const capture = createHttpCapture({
    ...options,
    maxBytes: 5,
    fetch: async () => response(),
  });
  expect(await (await capture.fetch("https://example.com")).text()).toBe(wire);
  const [manifest] = await capture.flush();
  expect(manifest).toMatchObject({
    outcome: "complete",
    bytesStored: 5,
    bytesObserved: Buffer.byteLength(wire),
    truncated: true,
  });
  expect(
    await readFile(path.join(options.directory, manifest!.file), "utf8"),
  ).toBe(wire.slice(0, 5));
});
it("keeps storage failure separate from the agent response", async () => {
  const options = await setup();
  const directory = path.join(options.directory, "not-a-directory");
  await writeFile(directory, "existing");
  const capture = createHttpCapture({
    ...options,
    directory,
    fetch: async () => response(),
  });
  expect(await (await capture.fetch("https://example.com")).text()).toBe(wire);
  expect((await capture.flush())[0]).toMatchObject({
    outcome: "complete",
    writeError: "CAPTURE_WRITE",
  });
});
it("preserves fetch rejection and omits request credentials from metadata", async () => {
  const options = await setup();
  const error = new Error("PRIVATE_ERROR");
  const fetchResponse = vi.fn(async () => {
    throw error;
  });
  const capture = createHttpCapture({ ...options, fetch: fetchResponse });
  const init = {
    headers: { authorization: "PRIVATE_TOKEN" },
    body: "PRIVATE_BODY",
    method: "POST",
  };
  await expect(
    capture.fetch("https://example.com/?secret=PRIVATE_URL", init),
  ).rejects.toBe(error);
  expect(fetchResponse).toHaveBeenCalledWith(
    "https://example.com/?secret=PRIVATE_URL",
    init,
  );
  const [manifest] = await capture.flush();
  expect(manifest!.outcome).toBe("fetch-error");
  expect(JSON.stringify(manifest)).not.toContain("PRIVATE_");
});
it("skips non-SSE responses without consuming or replacing them", async () => {
  const options = await setup();
  const original = new Response("not SSE");
  const capture = createHttpCapture({
    ...options,
    fetch: async () => original,
  });
  expect(await capture.fetch("https://example.com")).toBe(original);
  expect(original.bodyUsed).toBe(false);
  expect((await capture.flush())[0]!.outcome).toBe("skipped");
  expect(await readdir(options.directory)).toEqual([]);
});
it("preserves status and headers including non-successful SSE responses", async () => {
  const options = await setup();
  const original = new Response(wire, {
    status: 503,
    statusText: "Unavailable",
    headers: { "content-type": "text/event-stream", "x-test": "retained" },
  });
  Object.defineProperty(original, "url", {
    value: "https://example.com/final",
  });
  const capture = createHttpCapture({
    ...options,
    fetch: async () => original,
  });
  const result = await capture.fetch("https://example.com");
  expect(result.status).toBe(503);
  expect(result.statusText).toBe("Unavailable");
  expect(result.url).toBe(original.url);
  expect(result.headers.get("x-test")).toBe("retained");
  await result.text();
  await capture.flush();
});
it("isolates concurrent requests and uses unique filenames", async () => {
  const options = await setup();
  const capture = createHttpCapture({
    ...options,
    fetch: async () => response(),
  });
  await Promise.all([
    capture.fetch("https://a").then((r) => r.text()),
    capture.fetch("https://b").then((r) => r.text()),
  ]);
  const manifests = await capture.flush();
  expect(new Set(manifests.map((m) => m.file)).size).toBe(2);
  expect(manifests.every((m) => m.outcome === "complete")).toBe(true);
});
it("rejects unsupported retention limits before starting a fetch", async () => {
  const options = await setup();
  for (const maxBytes of [0, -1, 1.5, NaN, MAX_INPUT_BYTES + 1])
    expect(() => createHttpCapture({ ...options, maxBytes })).toThrow(
      RangeError,
    );
});

it("matches an uncaptured HttpAgent control run", async () => {
  const options = await setup();
  const fetchResponse = async () => response(wire.replaceAll("\r\n", "\n"));
  const control = new HttpAgent({
    url: "https://example.com",
    threadId: "t",
    fetch: fetchResponse,
  });
  const capture = createHttpCapture({ ...options, fetch: fetchResponse });
  const recorded = new HttpAgent({
    url: "https://example.com",
    threadId: "t",
    fetch: capture.fetch,
  });
  await control.runAgent({ runId: "r" });
  await recorded.runAgent({ runId: "r" });
  await capture.flush();
  expect(recorded.messages).toEqual(control.messages);
  expect(recorded.state).toEqual(control.state);
});

it("captures a real local HTTP SSE endpoint through HttpAgent", async () => {
  const { createServer } = await import("node:http");
  const options = await setup();
  const server = createServer((request, result) => {
    request.resume();
    result.writeHead(200, { "Content-Type": "text/event-stream" });
    result.end(wire.replaceAll("\r\n", "\n"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server address");
  const capture = createHttpCapture(options);
  try {
    const agent = new HttpAgent({
      url: `http://127.0.0.1:${address.port}`,
      threadId: "t",
      fetch: capture.fetch,
    });
    await agent.runAgent({ runId: "r" });
    const [manifest] = await capture.flush();
    expect(manifest!.outcome).toBe("complete");
    expect(
      parseTrace(
        await readFile(path.join(options.directory, manifest!.file), "utf8"),
      ).map((r) => r.event),
    ).toEqual(events);
  } finally {
    await capture.flush();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("settles capture reporting if a custom fetch returns a locked body", async () => {
  const options = await setup();
  const original = response();
  const reader = original.body!.getReader();
  const capture = createHttpCapture({
    ...options,
    fetch: async () => original,
  });
  await expect(capture.fetch("https://example.com")).rejects.toThrow(TypeError);
  expect((await capture.flush())[0]!.outcome).toBe("transport-error");
  await reader.cancel();
});
