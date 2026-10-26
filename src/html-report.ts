import { createHash } from "node:crypto";
import { lintEvents } from "./lint";
import type { Diagnostic, LintOptions, SourceEvent, LintResult } from "./types";

export type HtmlReportOptions = LintOptions & {
  source?: string;
  /** Maximum timeline rows, including prioritized finding evidence. Default 2,000. */
  maxEvents?: number;
};
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const bounded = (value: string, limit = 160) =>
  value.length > limit ? value.slice(0, limit) + "… [shortened]" : value;
const text = (value: string, limit = 160) => escape(bounded(value, limit));
const css = `
:root{color-scheme:light;--ink:#172d32;--muted:#53696e;--line:#cfdbd8;--paper:#fffefa;--accent:#005f57;--wash:#e8f0eb;--error:#9b2826;--warn:#805000}
*{box-sizing:border-box}body{margin:0;background:#f3f4ee;color:var(--ink);font:16px/1.55 system-ui,sans-serif}a{color:var(--accent);text-underline-offset:3px}a:hover{text-decoration-thickness:2px}a:focus-visible,input:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #865514;outline-offset:4px}header,main,footer{max-width:1320px;margin:auto;padding:32px}header{padding-top:48px}.eyebrow{font:700 12px/1.4 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}h1{font-size:clamp(32px,5vw,52px);line-height:1.1;letter-spacing:-.035em;margin:12px 0}h2{font-size:23px;letter-spacing:-.02em;margin:0 0 18px}h3{font-size:16px;margin:0}.source{color:var(--muted);overflow-wrap:anywhere;max-width:80ch}.metrics{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}.metric{min-width:145px;padding:16px 20px;border:1px solid var(--line);background:var(--paper);border-radius:10px}.metric strong{display:block;font-size:28px;line-height:1.2}.metric span,.muted{font-size:14px;color:var(--muted)}.layout{display:grid;grid-template-columns:minmax(270px,360px) minmax(0,1fr);gap:32px}section.panel{min-width:0}.finding,.event,.notice{border:1px solid var(--line);border-radius:10px;background:var(--paper);padding:18px;margin-bottom:12px}.finding{border-left:4px solid var(--error)}.finding.warning{border-left-color:var(--warn)}.finding p{margin:10px 0;overflow-wrap:anywhere}.rule{font:700 13px ui-monospace,monospace}.severity{font-size:12px;text-transform:uppercase;color:var(--error);margin-right:8px}.warning .severity{color:var(--warn)}.links{display:flex;flex-wrap:wrap;gap:14px;font-size:14px}.related{margin:12px 0 0;padding-left:20px;font-size:14px}.related li{margin:6px 0}.toolbar{position:sticky;top:0;z-index:1;background:#f3f4ee;padding:0 0 16px}.toolbar label{display:block;font-size:14px;font-weight:650;margin-bottom:6px}.search-row{display:flex;gap:8px}input{min-width:0;flex:1;padding:11px 13px;border:1px solid #8fa59e;border-radius:7px;font:inherit;background:var(--paper);color:var(--ink)}button{border:1px solid #8fa59e;border-radius:7px;background:var(--paper);color:var(--ink);font:inherit;padding:8px 14px;cursor:pointer}.group{margin:22px 0}.group-heading{padding:12px 0;border-bottom:1px solid var(--line);margin-bottom:14px;overflow-wrap:anywhere}.group-heading p{margin:3px 0;font-size:13px;color:var(--muted)}.event{padding:13px 16px}.event-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.event-type{font:650 13px ui-monospace,monospace;overflow-wrap:anywhere}.location{font:12px ui-monospace,monospace;color:var(--muted)}dl{display:flex;gap:8px 22px;flex-wrap:wrap;margin:10px 0 0}dl div{display:flex;gap:8px;min-width:0}dt{font-size:12px;color:var(--muted)}dd{font:12px/1.6 ui-monospace,monospace;margin:0;overflow-wrap:anywhere;max-width:45ch}.event:target{background:#fff5d8;border-color:#926016;outline:2px solid #926016;outline-offset:2px}.notice{background:var(--wash);font-size:14px}.notice p{margin:5px 0}details{margin-top:16px;font-size:14px}summary{cursor:pointer;font-weight:600}footer{border-top:1px solid var(--line);font-size:13px;color:var(--muted)}[hidden]{display:none!important}.skip{position:absolute;left:10px;top:-100px}.skip:focus{top:10px;background:white;padding:10px;z-index:5}noscript p{padding:12px;border:1px solid var(--line)}@media(max-width:800px){header,main,footer{padding:24px}.layout{grid-template-columns:1fr;gap:24px}.toolbar{position:static}.metric{min-width:120px;flex:1}h1{font-size:36px}}@media print{.toolbar,.skip{display:none}.layout{display:block}.finding,.event{break-inside:avoid}body{background:white}}
`;
const script = `
const search=document.getElementById('search');
const clear=document.getElementById('clear');
const rows=[...document.querySelectorAll('.event')];
const groups=[...document.querySelectorAll('.group')];
const count=document.getElementById('visible-count');
function filter(){
 const query=search.value.toLocaleLowerCase().trim();let visible=0;
 for(const row of rows){row.hidden=!row.dataset.search.toLocaleLowerCase().includes(query);if(!row.hidden)visible++;}
 for(const group of groups)group.hidden=![...group.querySelectorAll('.event')].some(row=>!row.hidden);
 count.textContent=visible+' of '+rows.length+' rendered events shown';
 document.getElementById('no-matches').hidden=visible!==0;
}
search.addEventListener('input',filter);
clear.addEventListener('click',()=>{search.value='';filter();search.focus();});
function reveal(){const id=location.hash.slice(1);if(!/^event-[0-9]+$/.test(id))return;const row=document.getElementById(id);if(!row)return;search.value='';filter();row.focus();row.scrollIntoView({block:'center'});}
window.addEventListener('hashchange',reveal);
for(const link of document.querySelectorAll('a[href^="#event-"]'))link.addEventListener('click',()=>setTimeout(reveal,0));
filter();reveal();
`;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64");

/** Standalone report containing bounded metadata, never raw event payloads. */
export function generateHtmlReport(
  records: readonly SourceEvent[],
  options: HtmlReportOptions = {},
): string {
  return formatHtmlReport(records, lintEvents(records, options), options);
}

/** Internal formatter for callers that have already linted these records. */
export function formatHtmlReport(
  records: readonly SourceEvent[],
  result: LintResult,
  options: HtmlReportOptions = {},
): string {
  const maxEvents = options.maxEvents ?? 2000;
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 10000)
    throw new RangeError(
      "Report maxEvents must be an integer between 1 and 10000",
    );
  const positions = new Map<number, number>();
  records.forEach((record, position) => {
    if (!positions.has(record.eventIndex))
      positions.set(record.eventIndex, position);
  });
  const selected = new Set<number>();
  const select = (index?: number) => {
    const position = index === undefined ? undefined : positions.get(index);
    if (position !== undefined && selected.size < maxEvents)
      selected.add(position);
  };
  for (const diagnostic of result.diagnostics) {
    select(diagnostic.eventIndex);
    for (const related of diagnostic.related ?? []) select(related.eventIndex);
  }
  for (let i = 0; i < records.length && selected.size < maxEvents; i++)
    selected.add(i);
  const eventLink = (index: number | undefined, label: string) => {
    const position = index === undefined ? undefined : positions.get(index);
    return position !== undefined && selected.has(position)
      ? `<a href="#event-${position}">${text(label)}</a>`
      : `<span class="muted">${text(label)} (event not rendered)</span>`;
  };
  const finding = (d: Diagnostic) => `<article class="finding ${d.severity}">
    <h3><span class="severity">${d.severity}</span><span class="rule">${text(d.ruleId)}</span></h3>
    <p>${text(d.message, 1000)}</p>
    <div class="links">${eventLink(d.eventIndex, `Event ${d.eventIndex ?? "?"} · ${d.line ?? "?"}:${d.column ?? "?"}`)}<a href="https://github.com/leracherry/flowlint/blob/main/REFERENCE.md#${d.ruleId === "ITEM_REOPEN" ? "diagnostic-evidence" : "current-coverage"}" target="_blank" rel="noopener noreferrer">Rule reference (online)</a></div>
    ${d.related?.length ? `<ul class="related">${d.related.map((r) => `<li>${eventLink(r.eventIndex, `${r.message} · ${r.line}:${r.column}`)}</li>`).join("")}</ul>` : ""}
  </article>`;
  type Group = { thread: string; run: string; agent: string; rows: string[] };
  const groups = new Map<string, Group>();
  let thread = "Unscoped thread",
    run = "Unscoped run",
    threadKey = thread,
    runKey = run;
  for (let position = 0; position < records.length; position++) {
    const record = records[position]!;
    const event =
      record.event && typeof record.event === "object"
        ? (record.event as Record<string, unknown>)
        : {};
    const value = (key: string) =>
      typeof event[key] === "string"
        ? bounded(event[key] as string)
        : undefined;
    const type = value("type") ?? "Unknown event";
    if (event.type === "RUN_STARTED") {
      thread = value("threadId") ?? "Unknown thread";
      run = value("runId") ?? "Unknown run";
      threadKey =
        typeof event.threadId === "string" ? event.threadId : "Unknown thread";
      runKey = typeof event.runId === "string" ? event.runId : "Unknown run";
    }
    if (!selected.has(position)) continue;
    const agent = value("subagentRunId") ?? "Untagged";
    const key = hash(
      JSON.stringify([
        threadKey,
        runKey,
        typeof event.subagentRunId === "string" ? event.subagentRunId : null,
      ]),
    );
    const group = groups.get(key) ?? { thread, run, agent, rows: [] };
    const ids = [
      "messageId",
      "toolCallId",
      "parentMessageId",
      "entityId",
    ].flatMap((name) => {
      const id = value(name);
      return id === undefined ? [] : [[name, id]];
    });
    const search = [
      type,
      thread,
      run,
      agent,
      String(record.eventIndex),
      ...ids.flat(),
    ].join(" ");
    group.rows.push(
      `<article class="event" id="event-${position}" tabindex="-1" data-search="${escape(search)}"><div class="event-head"><span class="event-type">${escape(type)}</span><span class="location">Event ${text(String(record.eventIndex))} · ${text(String(record.line))}:${text(String(record.column))}</span></div>${ids.length ? `<dl>${ids.map(([name, id]) => `<div><dt>${escape(name!)}</dt><dd>${escape(id!)}</dd></div>`).join("")}</dl>` : ""}</article>`,
    );
    groups.set(key, group);
  }
  const errors = result.diagnostics.filter(
    (d) => d.severity === "error",
  ).length;
  const warnings = result.diagnostics.length - errors;
  const source = options.source ?? "Recorded trace";
  const csp = `default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'sha256-${hash(css)}'; script-src 'sha256-${hash(script)}'`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><title>FlowLint · ${text(source, 240)}</title><style>${css}</style></head>
<body><a class="skip" href="#timeline">Skip to timeline</a>
<header><div class="eyebrow">FlowLint / trace report</div><h1>${result.valid ? "No lint errors found" : "Trace findings"}</h1><p class="source">${text(source, 500)}</p><div class="metrics"><div class="metric"><strong>${result.checkedEvents}</strong><span>events checked</span></div><div class="metric"><strong>${errors}</strong><span>errors</span></div><div class="metric"><strong>${warnings}</strong><span>warnings</span></div><div class="metric"><strong>${groups.size}</strong><span>rendered run / agent groups</span></div></div></header>
<main><div class="notice"><p>Payloads omitted. Entity identifiers, source names, and diagnostic messages are visible.</p><p>${options.allowPartial ? "Partial capture mode: uncertain boundaries may be warnings." : "Complete capture mode."} Acceptance covers the implemented rules, not full protocol certification.</p><details><summary>Coverage and timeline limits</summary><p>State and activity applicability can be unknown without recorded baselines. Review warnings for unavailable context.</p><p>Groups follow recorded RUN_STARTED fields and explicit subagent tags. Inherited ownership is not inferred. Events within each group retain arrival order; event indices preserve the cross-group sequence.</p><p>${selected.size} of ${records.length} events rendered; ${records.length - selected.size} omitted. Finding evidence is prioritized up to the row limit. Long labels and messages are shortened; use JSON diagnostics for full text. Filtering searches rendered metadata only.</p></details></div>
<div class="layout"><section class="panel" aria-labelledby="findings-title"><h2 id="findings-title">Findings <span class="muted">${result.diagnostics.length}</span></h2>${result.diagnostics.length ? result.diagnostics.map(finding).join("") : '<p class="muted">No findings in the recorded evidence. This does not prove every consumer behavior was checked.</p>'}</section>
<section class="panel" id="timeline" tabindex="-1" aria-labelledby="timeline-title"><h2 id="timeline-title">Event timeline</h2><div class="toolbar"><label for="search">Filter by event, identifier, run, or agent</label><div class="search-row"><input id="search" type="search" autocomplete="off" aria-describedby="visible-count"><button id="clear" type="button">Clear</button></div><p class="muted" id="visible-count" role="status" aria-live="polite">${selected.size} rendered events</p></div><noscript><p>Filtering requires JavaScript. Findings and event links remain available below.</p></noscript><p id="no-matches" hidden>No rendered events match this filter.</p>${[...groups.values()].map((g) => `<section class="group"><div class="group-heading"><h3>${escape(g.run)} / ${escape(g.agent)}</h3><p>Thread ${escape(g.thread)} · ${g.rows.length} rendered events</p></div>${g.rows.join("")}</section>`).join("")}</section></div></main>
<footer>AG-UI 1.0 · ${result.supportedRules.length} registered rules · Standalone report with no automatic network requests. Rule links open online documentation only when selected.</footer><script>${script}</script></body></html>`;
}
