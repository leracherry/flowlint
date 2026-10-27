import { createHash } from "node:crypto";
import { parseProducerSource } from "./producer-data.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;

/** Read bounded public data. Authenticate only GitHub API requests, never redirects. */
export async function requestText(url, { fetchImpl = fetch, token } = {}) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(15000),
    redirect: "error",
    headers: {
      "User-Agent": "flowlint-producer-check",
      ...(new URL(url).origin === "https://api.github.com" && token
        ? { Authorization: `Bearer ${token}` }
        : {}),
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error("Empty response body");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 2 * 1024 * 1024) throw new Error("Source exceeds 2 MiB limit");
    chunks.push(chunk);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
}

/** Fetch an immutable candidate revision and replay data without executing upstream code. */
export async function inspectProducerUpdates({
  manifest,
  readFixture,
  request,
  validate,
  revision,
  reviews = [],
}) {
  if (
    !sha.test(manifest.revision) ||
    !Array.isArray(manifest.traces) ||
    !manifest.traces.length
  )
    throw new Error("Invalid producer manifest");
  const sources = new Map();
  for (const trace of manifest.traces) {
    const url = new URL(trace.source);
    const prefix = `/ag-ui-protocol/ag-ui/blob/${manifest.revision}/`;
    const path = url.pathname.slice(prefix.length);
    if (
      url.origin !== "https://github.com" ||
      !url.pathname.startsWith(prefix) ||
      !/^apps\/dojo\/e2e\/tests\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.event-trace\.ts$/.test(
        path,
      ) ||
      !/^[a-zA-Z0-9_-]+\.ndjson$/.test(trace.file) ||
      !digest.test(trace.sha256) ||
      !digest.test(trace.sourceSha256)
    )
      throw new Error("Unexpected producer source or fixture path");
    const text = await readFixture(trace.file);
    if (hash(text) !== trace.sha256)
      throw new Error("Pinned fixture checksum mismatch");
    const before = describe(text, validate);
    if (before.events !== trace.events)
      throw new Error("Pinned fixture event count mismatch");
    let source = sources.get(path);
    if (!source) {
      source = { path, baselineSha256: trace.sourceSha256, traces: [] };
      sources.set(path, source);
    }
    if (
      source.baselineSha256 !== trace.sourceSha256 ||
      source.traces.some((t) => t.journey === trace.journey)
    )
      throw new Error("Inconsistent source manifest");
    source.traces.push({ ...trace, before });
  }
  const reviewed = new Map();
  for (const review of reviews) {
    if (
      !sources.has(review.path) ||
      !sha.test(review.revision) ||
      !digest.test(review.sha256) ||
      typeof review.reason !== "string" ||
      !review.reason.trim() ||
      reviewed.has(review.path)
    )
      throw new Error("Invalid producer review");
    reviewed.set(review.path, review);
  }
  if (revision === undefined) {
    const response = await request(
      "https://api.github.com/repos/ag-ui-protocol/ag-ui/commits/main",
    );
    revision = response === null ? undefined : JSON.parse(response).sha;
  }
  if (typeof revision !== "string" || !sha.test(revision))
    throw new Error("Unable to resolve a full candidate revision");
  const files = [];
  for (const source of sources.values()) {
    const file = {
      path: source.path,
      baselineSha256: source.baselineSha256,
      source: `https://github.com/ag-ui-protocol/ag-ui/blob/${revision}/${source.path}`,
      status: "unavailable",
      journeys: [],
    };
    files.push(file);
    try {
      const text = await request(
        `https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/${revision}/${source.path}`,
      );
      if (text === null) {
        file.status = "missing";
        continue;
      }
      file.candidateSha256 = hash(text);
      const journeys = parseProducerSource(text, source.path);
      const baseline = new Map(source.traces.map((t) => [t.journey, t]));
      for (const name of new Set([
        ...baseline.keys(),
        ...Object.keys(journeys),
      ])) {
        const before = baseline.get(name)?.before;
        const after = Object.hasOwn(journeys, name)
          ? describe(
              journeys[name].map((e) => JSON.stringify(e)).join("\n") + "\n",
              validate,
            )
          : undefined;
        file.journeys.push({
          name,
          status: !before
            ? "added"
            : !after
              ? "removed"
              : before.sha256 === after.sha256
                ? "unchanged"
                : "changed",
          ...(before ? { before } : {}),
          ...(after ? { after } : {}),
        });
      }
      file.status =
        file.candidateSha256 === file.baselineSha256 ? "unchanged" : "changed";
      // A source checksum cannot stand in for matching replayed fixtures.
      if (file.journeys.some((j) => j.status !== "unchanged"))
        file.status = "changed";
      const review = reviewed.get(file.path);
      if (
        file.status === "changed" &&
        review?.sha256 === file.candidateSha256
      ) {
        file.status = "reviewed";
        file.review = review;
      }
    } catch {
      file.status = "unavailable";
      file.error =
        "Source could not be downloaded, parsed as supported data, or validated; inspect the immutable source link";
    }
  }
  return {
    schemaVersion: 1,
    baselineRevision: manifest.revision,
    candidateRevision: revision,
    status: files.some((f) => f.status === "unavailable")
      ? "unavailable"
      : files.some((f) => f.status !== "unchanged" && f.status !== "reviewed")
        ? "review-required"
        : files.some((f) => f.status === "reviewed")
          ? "reviewed"
          : "unchanged",
    files,
  };
}
function describe(text, validate) {
  const result = validate(text);
  if (result.diagnostics.some((d) => d.ruleId.startsWith("LIMIT_")))
    throw new Error("Validation resource limit prevents complete replay");
  return {
    sha256: hash(text),
    events: result.checkedEvents,
    valid: result.valid,
    diagnostics: result.diagnostics.slice(0, 50),
    diagnosticsOmitted: Math.max(0, result.diagnostics.length - 50),
  };
}
export function formatProducerUpdates(report) {
  const lines = [
    "# Producer compatibility check",
    "",
    `Status: **${report.status}**`,
    "",
    `Baseline: ${report.baselineRevision ?? "unavailable"}`,
    `Candidate: ${report.candidateRevision ?? "unavailable"}`,
    "",
    "This checks watched recorded inputs with the current FlowLint build. It does not run live producers, establish application compatibility, or update the pinned corpus.",
    "",
  ];
  if (report.error) lines.push(report.error, "");
  for (const file of report.files) {
    lines.push(`- [${file.path}](${file.source}): **${file.status}**`);
    if (file.review)
      lines.push(
        `  - Reviewed at ${file.review.revision}: ${file.review.reason}`,
      );
    for (const journey of file.journeys)
      lines.push(
        `  - ${journey.name}: ${journey.status}; events ${journey.before?.events ?? "absent"} -> ${journey.after?.events ?? "absent"}; diagnostics ${journey.before ? journey.before.diagnostics.length + journey.before.diagnosticsOmitted : "absent"} -> ${journey.after ? journey.after.diagnostics.length + journey.after.diagnosticsOmitted : "absent"}`,
      );
  }
  lines.push(
    "",
    "Review changed source, recording normalization, journey coverage, and diagnostics before changing any pin or expectation. Missing or unreadable sources leave coverage incomplete. See docs/maintenance.md.",
    "",
  );
  return lines.join("\n");
}
