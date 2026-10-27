import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { lintEvents, parseTrace } from "../src/index";
import { parseProducerSource } from "../scripts/lib/producer-data.mjs";
import {
  inspectProducerUpdates,
  requestText,
  formatProducerUpdates,
} from "../scripts/lib/producer-updates.mjs";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const baselineRevision = "a".repeat(40),
  candidateRevision = "b".repeat(40);
const events = [
  { type: "RUN_STARTED", threadId: "t", runId: "r" },
  { type: "RUN_FINISHED", threadId: "t", runId: "r" },
];
const fixture = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
const source = `import { defineEventTrace } from './recorder'; export const data = defineEventTrace(import.meta.url, { chat: ${JSON.stringify(events)} });`;
const makeManifest = () => ({
  revision: baselineRevision,
  traces: [
    {
      file: "producer-chat.ndjson",
      journey: "chat",
      events: 2,
      sha256: hash(fixture),
      sourceSha256: hash(source),
      source: `https://github.com/ag-ui-protocol/ag-ui/blob/${baselineRevision}/apps/dojo/e2e/tests/producer/chat.event-trace.ts`,
    },
  ],
});
const options = (candidate = source) => ({
  manifest: makeManifest(),
  readFixture: async () => fixture,
  request: async (url) =>
    url.startsWith("https://api.github.com/")
      ? JSON.stringify({ sha: candidateRevision })
      : candidate,
  validate: (text) => lintEvents(parseTrace(text)),
});
it("replays unchanged source at a resolved immutable revision", async () => {
  const request = vi.fn(options().request);
  const report = await inspectProducerUpdates({ ...options(), request });
  expect(report.status).toBe("unchanged");
  expect(report.candidateRevision).toBe(candidateRevision);
  expect(request.mock.calls[1][0]).toContain(`/${candidateRevision}/`);
  expect(report.files[0].journeys[0].after.valid).toBe(true);
  expect(formatProducerUpdates(report)).toContain(
    "does not run live producers",
  );
});
it("reports a changed capture and its new lint finding without rewriting the baseline", async () => {
  const candidate = source.replace(
    JSON.stringify(events),
    JSON.stringify(events.slice(0, -1)),
  );
  const config = options(candidate),
    original = structuredClone(config.manifest);
  const report = await inspectProducerUpdates(config);
  expect(report.status).toBe("review-required");
  expect(report.files[0].journeys[0]).toMatchObject({
    status: "changed",
    before: { valid: true },
    after: { valid: false, diagnostics: [{ ruleId: "FL012" }] },
  });
  expect(config.manifest).toEqual(original);
});
it("requires review for source-only changes and added or removed journeys", async () => {
  expect(
    (await inspectProducerUpdates(options(source + "\n// recording changed")))
      .status,
  ).toBe("review-required");
  const report = await inspectProducerUpdates(
    options(source.replace("chat:", "newChat:")),
  );
  expect(report.files[0].journeys.map((j) => j.status)).toEqual([
    "removed",
    "added",
  ]);
});
it("reports missing sources without claiming passing coverage", async () => {
  const report = await inspectProducerUpdates({
    ...options(null),
    revision: candidateRevision,
  });
  expect(report.status).toBe("review-required");
  expect(report.files[0].status).toBe("missing");
  expect(report.files[0].journeys).toEqual([]);
});
it("marks unsupported syntax and network failures unavailable", async () => {
  const unsupported = source.replace(JSON.stringify(events), "buildTrace()");
  expect((await inspectProducerUpdates(options(unsupported))).status).toBe(
    "unavailable",
  );
  expect(
    (
      await inspectProducerUpdates({
        ...options(),
        revision: candidateRevision,
        request: async () => {
          throw new Error("network unavailable");
        },
      })
    ).status,
  ).toBe("unavailable");
});
it("fails before fetching when a pinned fixture changes or a source escapes the allowlist", async () => {
  const request = vi.fn();
  await expect(
    inspectProducerUpdates({
      ...options(),
      request,
      readFixture: async () => "changed",
    }),
  ).rejects.toThrow("checksum");
  const manifest = makeManifest();
  manifest.traces[0].source = "https://example.com/source";
  await expect(
    inspectProducerUpdates({ ...options(), request, manifest }),
  ).rejects.toThrow("source");
  expect(request).not.toHaveBeenCalled();
});
it("rejects missing or non-immutable candidate revisions", async () => {
  await expect(
    inspectProducerUpdates({ ...options(), revision: "main" }),
  ).rejects.toThrow("revision");
  await expect(
    inspectProducerUpdates({ ...options(), request: async () => null }),
  ).rejects.toThrow("revision");
});
it("never executes calls, spreads, or executable upstream statements", () => {
  for (const unsafe of [
    "process.exit(1)",
    "const x = danger();",
    "const x = { ...danger };",
    "const x = defineEventTrace(import.meta.url, { chat: build() });",
  ])
    expect(() => parseProducerSource(unsafe)).toThrow();
  expect(() => parseProducerSource("export const x = []; ")).toThrow(
    "No recorded journeys",
  );
  expect(
    parseProducerSource(
      `const EVENTS = ${JSON.stringify(events)} as const; export const x = defineEventTrace(import.meta.url, { chat: EVENTS });`,
    ).chat,
  ).toEqual(events);
});
it("bounds downloads and authenticates only API requests without following redirects", async () => {
  const fetchImpl = vi.fn(async () => new Response("source"));
  await requestText(
    "https://api.github.com/repos/ag-ui-protocol/ag-ui/commits/main",
    { fetchImpl, token: "test-token" },
  );
  await requestText(
    "https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/revision/file",
    { fetchImpl, token: "test-token" },
  );
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(
    "Bearer test-token",
  );
  expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBeUndefined();
  expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
  await expect(
    requestText("https://example.com", {
      fetchImpl: async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
    }),
  ).rejects.toThrow("limit");
  expect(
    await requestText("https://example.com", {
      fetchImpl: async () => new Response(null, { status: 404 }),
    }),
  ).toBeNull();
  await expect(
    requestText("https://example.com", {
      fetchImpl: async () => new Response(null, { status: 429 }),
    }),
  ).rejects.toThrow("429");
});

it("acknowledges only an exactly reviewed source hash and alerts on later edits", async () => {
  const changed = source + "\n// reviewed metadata";
  const review = {
    path: "apps/dojo/e2e/tests/producer/chat.event-trace.ts",
    revision: candidateRevision,
    sha256: hash(changed),
    reason: "Reviewed metadata-only change",
  };
  const report = await inspectProducerUpdates({
    ...options(changed),
    reviews: [review],
  });
  expect(report.status).toBe("reviewed");
  expect(report.files[0].review).toEqual(review);
  expect(
    (
      await inspectProducerUpdates({
        ...options(changed + "\n// new change"),
        reviews: [review],
      })
    ).status,
  ).toBe("review-required");
  expect(
    (
      await inspectProducerUpdates({
        ...options(null),
        revision: candidateRevision,
        reviews: [review],
      })
    ).status,
  ).toBe("review-required");
  await expect(
    inspectProducerUpdates({
      ...options(),
      reviews: [{ ...review, sha256: "invalid" }],
    }),
  ).rejects.toThrow("review");
});
it("rejects malformed data and invalid UTF-8 instead of silently changing source bytes", async () => {
  expect(() =>
    parseProducerSource(
      "export const x = defineEventTrace(import.meta.url, { chat: [ }",
    ),
  ).toThrow("syntax");
  expect(() =>
    parseProducerSource(
      "const x = 1e999; export const y = defineEventTrace(import.meta.url, { chat: [] });",
    ),
  ).toThrow("Non-finite");
  await expect(
    requestText("https://example.com", {
      fetchImpl: async () => new Response(new Uint8Array([255])),
    }),
  ).rejects.toThrow();
});

it("does not acknowledge a replay that hits a validator resource limit", async () => {
  let calls = 0;
  const validate = (text) =>
    ++calls === 1
      ? lintEvents(parseTrace(text))
      : {
          checkedEvents: 2,
          valid: false,
          diagnostics: [{ ruleId: "LIMIT_DIAGNOSTICS" }],
        };
  const report = await inspectProducerUpdates({ ...options(), validate });
  expect(report.status).toBe("unavailable");
});
