// Renders a report record to HTML. Same layout as the original IdeaInspector report, with every value escaped.
import { esc, fmtDate, isHttpUrl } from './util.js';

export function colorForScore(s) { if (s >= 70) return 'var(--good)'; if (s >= 45) return 'var(--accent)'; return 'var(--risk)'; }
export function labelForScore(s) {
  if (s >= 80) return 'Strong Opportunity';
  if (s >= 65) return 'Promising, With Gaps';
  if (s >= 45) return 'Needs Rework';
  return 'High Risk';
}
export function colorForSeverity(sev) { const s = String(sev || '').toLowerCase(); if (s === 'high') return 'var(--risk)'; if (s === 'medium') return 'var(--accent)'; return 'var(--good)'; }
export function colorForBizVerdict(v) { const s = String(v || '').toLowerCase(); if (s.includes('strong') || s.includes('good')) return 'var(--good)'; if (s.includes('weak') || s.includes('bad')) return 'var(--risk)'; return 'var(--accent)'; }
export function colorForFinalCall(c) { const s = String(c || '').toLowerCase(); if (s === 'go') return 'var(--good)'; if (s === 'pass') return 'var(--risk)'; return 'var(--accent)'; }
export function colorForConfidence(c) { const s = String(c || '').toLowerCase(); if (s === 'high') return 'var(--good)'; if (s === 'low') return 'var(--risk)'; return 'var(--accent)'; }
export function colorForOutcome(o) { const s = String(o || '').toLowerCase(); if (s.includes('succ')) return 'var(--good)'; if (s.includes('fail')) return 'var(--risk)'; return 'var(--accent)'; }
export function colorForReadiness(r) { const s = String(r || '').toLowerCase(); if (s === 'yes') return 'var(--good)'; if (s === 'no') return 'var(--risk)'; return 'var(--accent)'; }
export function colorForDelta(d) { if (d > 0) return 'var(--good)'; if (d < 0) return 'var(--risk)'; return 'var(--muted)'; }

export function deltaText(d) { return d > 0 ? '▲ +' + d : d < 0 ? '▼ ' + d : '– No change'; }

function renderSeal(score) {
  const r = 46, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = colorForScore(score);
  return `<svg viewBox="0 0 108 108">
    <circle cx="54" cy="54" r="${r}" fill="none" stroke="var(--paper-2)" stroke-width="7"/>
    <circle cx="54" cy="54" r="${r}" fill="none" stroke="${color}" stroke-width="7"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"
      stroke-linecap="round" transform="rotate(-90 54 54)"/>
  </svg>
  <div class="num">
    <div class="score" style="color:${color}">${esc(score)}</div>
    <div class="of">OUT OF 100</div>
  </div>`;
}

const list = (arr, fn) => (Array.isArray(arr) ? arr : []).map(fn).join('');
const num = (v, d = 0) => (Number.isFinite(+v) ? Math.max(0, Math.min(100, +v)) : d);

export function buildReportContentHTML(record) {
  const data = record.data;
  const score = num(data.overall_score);
  const color = colorForScore(score);
  const when = record.updatedAt || record.createdAt;
  let html = '';

  html += `<div style="display:flex;justify-content:flex-end;font-family:var(--mono);font-size:11px;color:var(--muted);margin-bottom:22px;letter-spacing:0.5px;padding-bottom:14px;border-bottom:1px solid var(--rule);">
    <span>${esc(record.refId)}</span>
  </div>`;

  html += `<div class="verdict-block">
    <div class="seal">${renderSeal(score)}</div>
    <div class="verdict-text">
      <div class="verdict-label" style="color:${color}">${esc(labelForScore(score))}</div>
      <p class="idea-title">${esc(data.title)}</p>
      <p class="summary">${esc(data.summary)}</p>
      ${typeof record.scoreDelta === 'number' ? `<div class="score-delta" style="color:${colorForDelta(record.scoreDelta)}">${esc(deltaText(record.scoreDelta))} vs previous run of this report (was ${esc(record.previousScore)}/100)</div>` : ''}
    </div>
  </div>`;

  if (data.methodology_note || data.confidence) {
    const cc = colorForConfidence(data.confidence);
    html += `<div class="method-box">
      <div class="method-text"><strong style="font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);">How this was scored — </strong>${esc(data.methodology_note || '')}</div>
      ${data.confidence ? `<div class="confidence-badge" style="color:${cc}">${esc(data.confidence)} Confidence</div>` : ''}
    </div>`;
  }

  if (data.top_risk || data.score_drivers) {
    html += `<div class="callout-row">
      ${data.top_risk ? `<div class="callout-box risk"><div class="callout-label">Biggest Risk To Solve First</div><div class="callout-text">${esc(data.top_risk)}</div></div>` : ''}
      ${data.score_drivers ? `<div class="callout-box driver"><div class="callout-label">What Would Move The Score</div><div class="callout-text">${esc(data.score_drivers)}</div></div>` : ''}
    </div>`;
  }

  if (data.tldr) {
    html += `<div class="tldr-box"><div class="tldr-label">TL;DR</div><div class="tldr-text">${esc(data.tldr)}</div></div>`;
  }

  if (data.snapshot) {
    html += `<div class="snapshot-grid">
      <div class="snap-item"><div class="snap-label">Problem</div><div class="snap-text">${esc(data.snapshot.problem)}</div></div>
      <div class="snap-item"><div class="snap-label">Solution</div><div class="snap-text">${esc(data.snapshot.solution)}</div></div>
      <div class="snap-item"><div class="snap-label">Customer</div><div class="snap-text">${esc(data.snapshot.customer)}</div></div>
    </div>`;
  }

  html += `<div class="section-title">Category Breakdown</div>`;
  list(data.categories, cat => {
    const s = num(cat.score);
    html += `<div class="cat">
      <div class="cat-head"><span class="name">${esc(cat.name)}${cat.weight ? `<span class="weight">(${esc(cat.weight)})</span>` : ''}</span><span class="val">${esc(s)}/100</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${s}%;background:${colorForScore(s)}"></div></div>
      <p class="cat-note">${esc(cat.note)}</p>
    </div>`;
    return '';
  });

  if (data.market) {
    const m = data.market;
    const mc = m.confidence ? colorForConfidence(m.confidence) : null;
    html += `<div class="section-title">Market &amp; Competition${mc ? `<span class="section-confidence" style="color:${mc}">${esc(m.confidence)} Confidence</span>` : ''}</div><div class="market-block">`;
    if (m.customer_profile) html += `<div class="market-row"><div class="m-label">Target Customer</div><div class="m-val">${esc(m.customer_profile)}</div></div>`;
    if (m.market_size_note) html += `<div class="market-row"><div class="m-label">Market Size</div><div class="m-val">${esc(m.market_size_note)}</div></div>`;
    if (m.competitors && m.competitors.length) html += `<div class="market-row"><div class="m-label">Competitors</div><div class="m-val">${m.competitors.map(c => `<span class="competitor-chip">${esc(c)}</span>`).join('')}</div></div>`;
    if (m.whitespace) html += `<div class="market-row"><div class="m-label">Whitespace</div><div class="m-val">${esc(m.whitespace)}</div></div>`;
    if ((m.competitors && m.competitors.length) || m.market_size_note) {
      html += `<div style="font-family:var(--mono);font-size:9.5px;color:var(--muted);font-style:italic;margin-top:2px;">Figures and competitor details reflect public information as of the report date (${esc(fmtDate(when))}) — verify before relying on them.</div>`;
    }
    html += `</div>`;
  }

  if (data.business_model) {
    const b = data.business_model;
    const bmc = b.confidence ? colorForConfidence(b.confidence) : null;
    html += `<div class="section-title">Business Model &amp; Revenue${bmc ? `<span class="section-confidence" style="color:${bmc}">${esc(b.confidence)} Confidence</span>` : ''}</div>
    <div class="bizmodel-box">
      <div class="bizmodel-head"><span class="bizmodel-verdict" style="color:${colorForBizVerdict(b.verdict)}">${esc(b.verdict || '')}</span></div>
      <dl>
        ${b.pricing_note ? `<dt>Pricing</dt><dd>${esc(b.pricing_note)}</dd>` : ''}
        ${b.unit_economics_note ? `<dt>Unit Economics</dt><dd>${esc(b.unit_economics_note)}</dd>` : ''}
        ${b.scalability_note ? `<dt>Scalability</dt><dd>${esc(b.scalability_note)}</dd>` : ''}
      </dl>
    </div>`;
  }

  if (data.risks && data.risks.length) {
    html += `<div class="section-title">Risk Register</div>` + list(data.risks, r => `<div class="risk-row">
        <span class="risk-sev" style="color:${colorForSeverity(r.severity)}">${esc(r.severity || '')}</span>
        <span class="risk-cat">${esc(r.category || '')}</span>
        <span class="risk-note">${esc(r.note || '')}</span>
      </div>`);
  }

  html += `<div class="section-title">Strengths &amp; Weaknesses</div>
  <div class="two-col">
    <div class="list-block strengths"><h3>Strengths</h3><ul>${list(data.strengths, s => `<li>${esc(s)}</li>`)}</ul></div>
    <div class="list-block weaknesses"><h3>Weaknesses</h3><ul>${list(data.weaknesses, s => `<li>${esc(s)}</li>`)}</ul></div>
  </div>`;

  if (data.do_list || data.dont_list) {
    html += `<div class="section-title">What To Do / What Not To Do</div>
    <div class="dodont-grid">
      <div class="do-col"><h3>Do</h3><ul>${list(data.do_list, s => `<li>${esc(s)}</li>`)}</ul></div>
      <div class="dont-col"><h3>Don't</h3><ul>${list(data.dont_list, s => `<li>${esc(s)}</li>`)}</ul></div>
    </div>`;
  }

  if (data.roadmap && data.roadmap.length) {
    html += `<div class="section-title">Next-Step Roadmap</div>` + list(data.roadmap, st => `<div class="roadmap-item"><div class="roadmap-phase">${esc(st.phase || '')}</div><div class="roadmap-action">${esc(st.action || '')}</div></div>`);
  } else if (data.improvements) {
    html += `<div class="section-title">Where To Improve</div><div class="improve">` +
      list(data.improvements, (imp, i) => `<div class="improve-item"><div class="idx">${String(i + 1).padStart(2, '0')}</div><div class="txt">${esc(imp)}</div></div>`) + `</div>`;
  }

  if (data.comparables && data.comparables.length) {
    html += `<div class="section-title">Comparable Companies</div>` + list(data.comparables, c => `<div class="comp-row">
        <span class="comp-name">${esc(c.name || '')}</span>
        <span class="comp-outcome" style="color:${colorForOutcome(c.outcome)}">${esc(c.outcome || '')}</span>
        <span class="comp-lesson">${esc(c.lesson || '')}</span>
      </div>`);
  }

  if (data.readiness && data.readiness.length) {
    html += `<div class="section-title">Investor Readiness</div>` + list(data.readiness, rd => `<div class="readiness-row">
        <span class="readiness-stage">${esc(rd.stage || '')}</span>
        <span class="readiness-tag" style="color:${colorForReadiness(rd.ready)}">${esc(rd.ready || '')}</span>
        <span class="readiness-note">${esc(rd.note || '')}</span>
      </div>`);
  }

  if (data.final_verdict) {
    const fc = colorForFinalCall(data.final_verdict.call);
    html += `<div class="section-title">Final Verdict</div>
    <div class="verdict-final" style="border-color:${fc}">
      <div class="vf-call" style="color:${fc}">${esc(data.final_verdict.call || '')}</div>
      <div class="vf-rationale">${esc(data.final_verdict.rationale || '')}</div>
    </div>`;
  }

  if (record.sources && record.sources.length) {
    html += `<div class="section-title">Sources</div><div class="sources-list">` +
      record.sources.filter(s => isHttpUrl(s.url)).map(s => `<div><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></div>`).join('') + `</div>`;
  }

  html += `<div style="margin-top:32px;padding-top:14px;border-top:1px solid var(--rule);font-family:var(--mono);font-size:10.5px;color:var(--muted);letter-spacing:0.5px;">
    Automated first-pass diligence — not investment advice. Generated by IdeaInspector on ${esc(fmtDate(when, true))}.
  </div>`;

  const bits = [];
  if (record.links && record.links.length) bits.push(record.links.length + ' link(s): ' + record.links.join(', '));
  if (record.attachments) {
    if (record.attachments.pdf) bits.push('1 PDF attached');
    if (record.attachments.images) bits.push(record.attachments.images + ' image(s) attached');
  }
  if (bits.length) html += `<div style="margin-top:8px;font-family:var(--mono);font-size:10px;color:var(--muted);letter-spacing:0.3px;word-break:break-word;">Submitted with: ${esc(bits.join(' · '))}</div>`;

  return html;
}
