# Capture an HttpAgent response

This integration records SSE bytes consumed by a Node.js AG-UI `HttpAgent` and
writes an adjacent provenance manifest. It is tested with `@ag-ui/client` 1.0.3.
It does not depend on a particular server framework or make model calls itself.

The capture API and suites are available from 1.1.0. To run the bundled example
from a repository checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
node examples/capture-http.mjs http://localhost:8000/agent ./captures my-adapter 1.2.3
node dist/cli.js suite "captures/*.sse"
```

Supply your actual endpoint and adapter version. The example starts a new run
without user messages; adapt its `HttpAgent` configuration and messages to your
application. A real backend may require credentials, a nonempty conversation, or
additional inputs. No endpoint, server, or model is started by the example.

## Add recording to an existing Node application

Install `@leracherry/flowlint@1.1.0` and `@ag-ui/client@1.0.3`, and commit your
application's lockfile. The integration point is the
[official HttpAgent custom fetch option](https://github.com/ag-ui-protocol/ag-ui/blob/main/sdks/typescript/packages/client/src/agent/types.ts).

```ts
import { HttpAgent } from "@ag-ui/client";
import { createHttpCapture } from "@leracherry/flowlint";

const capture = createHttpCapture({
  directory: "./captures",
  producer: { name: "my-adapter", version: "1.2.3" },
});
const agent = new HttpAgent({
  url: "http://localhost:8000/agent",
  fetch: capture.fetch,
});
try {
  await agent.runAgent();
} finally {
  const manifests = await capture.flush();
  for (const manifest of manifests) {
    if (
      manifest.writeError ||
      manifest.truncated ||
      manifest.outcome !== "complete"
    ) {
      console.error(
        "Incomplete capture:",
        manifest.captureId,
        manifest.outcome,
      );
    }
  }
}
```

Attach `capture.fetch` to the agent your application already uses, preserving its
messages, authentication, run options, cancellation, and subscriber behavior.
You can supply an existing custom fetch as the capture's `fetch` option.

The producer name/version are caller-provided provenance, not independently
verified detection. Record the real adapter/framework version rather than the
client version if the server is what you intend to test. Capture starts at a
response boundary and says nothing about earlier requests or prior history.

## What is recorded

Each recognized SSE response receives a unique `<captureId>.sse` file and
`<captureId>.manifest.json`. The raw file contains a byte-for-byte prefix of the
consumed response body, retaining UTF-8 bytes, SSE comments, framing, and order.
It is not a normalized event recording. Fetch already decodes HTTP content
encoding, so this is not a capture of compressed network packets.

The version-1 manifest contains:

- `captureId`, the raw file basename, `format: "sse"`, and the caller's producer.
- `source: "http-response-body"` and a request-start timestamp.
- `outcome`: `complete`, `cancelled`, `transport-error`, `fetch-error`, or `skipped`.
- `bytesObserved`, `bytesStored`, `truncated`, and SHA-256 of the stored bytes.
- `transformations: []`: no redaction, event insertion, or repair was applied.
- An optional `writeError: "CAPTURE_WRITE"` in the returned result if persistence failed.

`complete` means the consumer observed response EOF. It does not mean the protocol
was valid or contained a terminal event. Run `suite` to determine that. A protocol
`RUN_ERROR` is a recorded event, not automatically a transport failure. An interrupted
or partial stream can have invalid SSE framing; `--allow-partial` does not repair it.

Non-SSE responses or responses without a body are returned unchanged and reported
as `skipped` without writing files. Fetch failures write an empty body and manifest
if storage is available, and rethrow the original fetch error. A raw file may exist
without a manifest if writing the manifest failed. Always inspect `flush()` results.

## Content and resource boundaries

Recording is explicit opt-in and includes response payloads, including message
text, tool arguments, shared state, and opaque artifacts. Request URLs, query
strings, headers, credentials, and request bodies are not added to manifests.
Response payloads themselves may contain secrets. Files are not automatically safe
to publish, and the hash is an integrity check rather than anonymization.

The default `maxBytes` is 10 MiB, matching FlowLint's input limit. A positive integer
up to that limit can lower retention. Bytes after the cap are still delivered to
the caller; `truncated` marks the saved prefix. No truncation event is injected.
Files use exclusive creation, with owner-only mode requested on platforms that
support it; existing directory permissions and Windows ACLs are not changed.

The recorder has no second consumer and does not prefetch a response body. It
copies at most `maxBytes` of body content per response and persists after EOF,
error, or cancellation. Concatenation can temporarily duplicate those bytes.
Concurrent responses have separate budgets; summaries are retained for the
lifetime of the recorder. Use a recorder per scenario, rather than as an unbounded
process-wide archive. Storage errors do not replace agent results or transport
errors. Copying and finalization still add CPU/memory overhead; there is no
production latency guarantee.

`flush()` waits for captures started before the call. It does not drain unconsumed
responses, start requests, or wait for future requests. Consume or cancel every
response first, then await flush before process exit or deleting output directories.
A response left unread can leave flush waiting indefinitely, as its outcome is
not yet known. Cancel through your application's usual cancellation mechanism.

The wrapper targets Node HttpAgent SSE consumption. Recognized SSE responses are
reconstructed with status, status text, headers, URL, type, and redirect metadata.
Response object identity is different, the original body is locked, and native
`Response.clone()` metadata behavior is not extended. It is not a browser extension
or a general fetch instrumentation replacement.

## Automated integration evidence

`test/capture.test.ts` runs the installed client against a deterministic SSE
response and a local HTTP endpoint. It compares events and final messages against
an uncaptured run and validates recorded events with FlowLint. Additional tests
cover byte-split UTF-8 and CRLF, cancellation, storage failure, transport failure,
non-SSE responses, response metadata, concurrent requests, and bounded retention.
The client integration uses LF framing. SDK 1.0.3 rejected the CRLF test response;
the recorder's byte-preservation tests still cover CRLF without normalizing it.

These are controlled integration tests, not live model/provider recordings or an
external design partner's endorsement. Partner onboarding time, production
capture overhead, and retention through a real upgrade remain unverified. Existing
producer corpus gaps, including recorded state deltas and encrypted values, remain
listed in [coverage](coverage.md).

### Local overhead observation

On Node 24.22.1, an in-memory five-event HttpAgent response containing 4,400 bytes
was run 22 times with and without recording, discarding the first two iterations.
The 20 measured runs had median agent completion times of 0.210 ms for the control
and 0.256 ms with capture; awaiting persistence afterward had a 0.302 ms median.
This small local experiment excludes real network/provider work and is not an
SLA, a peak-memory measurement, or evidence of production overhead. Partner
workloads still need their own acceptable budget and measurement.
