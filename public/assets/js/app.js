// IdeaInspector dashboard: new idea -> report -> consultant chats -> re-run in place.
import { esc, uid, fmtDate, renderMarkdown } from './util.js';
import * as db from './db.js';
import { PROVIDERS, providerById, loadSettings, saveSettings, clearSecrets, llmPayload, configProblem } from './settings.js';
import { api } from './api.js';
import { buildReportContentHTML, colorForScore, labelForScore, colorForDelta, deltaText } from './render.js';
import { exportPDF, exportSummaryPDF } from './pdf.js';

const view = document.getElementById('view');
const modalRoot = document.getElementById('modalRoot');
const toastRoot = document.getElementById('toastRoot');

let settings = loadSettings();
let serverCfg = {};
let emptyChatId = null;          // a freshly created chat that has no messages yet (removed if you leave it empty)
let ctx = {};                    // the report/chat currently on screen
let formState = { name: '', idea: '', links: '' };
let draftFiles = { pdf: null, images: [] };
let newRun = { active: false, stage: '', timer: null };
const pendingChats = new Set(); // chat ids waiting for a consultant reply

const MAX_TOTAL_BYTES = 3 * 1024 * 1024; // keeps requests under Vercel's ~4.5 MB body limit once base64-encoded
const MAX_IMAGES = 3;

const STARTERS = [
  { label: 'Why is my score what it is?', text: 'Walk me through why my idea got this score. Which category hurt it most, and is the score fair?' },
  { label: 'What should I fix first?', text: 'If I could fix only one thing this month, what should it be and why? Be specific.' },
  { label: 'The report got my idea wrong', text: 'I think the report misunderstood my idea. Let me explain what it actually is. Please ask me what you need to know.' }
];
const COMMANDS = [
  { cmd: 'swot', label: 'SWOT', text: 'Run a SWOT analysis on my idea.' },
  { cmd: 'market-scan', label: 'Market scan', text: 'Run a market scan for my idea: size, growth, trends and key players.' },
  { cmd: 'competitor-profile', label: 'Competitors', text: 'Profile my most important competitors and tell me how I would win against them.' },
  { cmd: 'customer-analysis', label: 'Customers', text: 'Analyze my target customer segments: who feels the pain most, and how do I reach them?' },
  { cmd: 'pricing-analysis', label: 'Pricing', text: 'Review my pricing and monetization, and propose a better pricing structure.' },
  { cmd: 'financial-model', label: 'Unit economics', text: 'Build a simple financial model and unit economics for my idea with clearly marked assumptions.' },
  { cmd: 'risk-assessment', label: 'Risks', text: 'Run a risk assessment on my idea and tell me how to mitigate the top risks.' },
  { cmd: 'market-entry', label: 'Go-to-market', text: 'Design a go-to-market plan for my first 90 days.' }
];

// ---------- small UI helpers ----------

function toast(html, ms = 5000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function openModal(title) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="m-head"><h2>${esc(title)}</h2><button class="btn sm" type="button" data-close>Close</button></div>
    <div class="m-body"></div><div class="m-foot"></div></div>`;
  modalRoot.appendChild(back);
  const api_ = { body: back.querySelector('.m-body'), foot: back.querySelector('.m-foot'), locked: false };
  const close = () => { if (api_.locked) return; back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', e => { if (e.target === back || e.target.hasAttribute('data-close')) close(); });
  api_.close = () => { api_.locked = false; close(); };
  return api_;
}

function errorBox(msg, extra = '') {
  return `<div class="error-box">${esc(msg)}${extra}</div>`;
}

function setupProblemHTML() {
  const p = configProblem(settings, serverCfg);
  return p ? `<div class="banner"><span>${esc(p)}</span><a class="btn sm primary" href="#/settings">Open Settings</a></div>` : '';
}

function reportPayload(r) {
  return { ideaName: r.ideaName, idea: r.idea, links: r.links, attachments: r.attachments, previousScore: r.previousScore, data: r.data };
}

function setNav(name) {
  const key = ['report'].includes(name) ? 'reports' : name === 'chat' ? 'chats' : name;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === key));
}

async function updateCounts() {
  try {
    const [r, c] = await Promise.all([db.getAll('reports'), db.getAll('chats')]);
    document.getElementById('countReports').textContent = r.length || '';
    document.getElementById('countChats').textContent = c.filter(x => x.messages && x.messages.length).length || '';
  } catch { /* ignore */ }
}

// ---------- router ----------

function parseRoute() {
  const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'new', id: id ? decodeURIComponent(id) : '' };
}

async function cleanupEmptyChat(r) {
  if (!emptyChatId) return;
  if (r.name === 'chat' && r.id === emptyChatId) return;
  const c = await db.get('chats', emptyChatId);
  if (c && (!c.messages || !c.messages.length)) await db.del('chats', emptyChatId);
  emptyChatId = null;
}

async function route() {
  const r = parseRoute();
  await cleanupEmptyChat(r);
  setNav(r.name);
  window.scrollTo(0, 0);
  try {
    if (r.name === 'new') await viewNew();
    else if (r.name === 'reports') await viewReports();
    else if (r.name === 'report') await viewReport(r.id);
    else if (r.name === 'chats') await viewChats();
    else if (r.name === 'chat') await viewChat(r.id);
    else if (r.name === 'settings') await viewSettings();
    else location.hash = '#/new';
  } catch (e) {
    console.error(e);
    view.innerHTML = errorBox('Something went wrong: ' + e.message);
  }
  updateCounts();
}

window.addEventListener('hashchange', route);

// ---------- New idea ----------

const LOADING_STAGES = (hasFiles, hasLinks) => ['Reading your submission…'].concat(hasFiles ? ['Reviewing attachments…'] : [], hasLinks ? ['Checking the links you provided…'] : [],
  ['Searching the competitive landscape…', 'Scoring across market, model, and risk…', 'Drafting the memo…']);

function loadingHTML(msg) {
  return `<div class="loading"><span id="loadingMsg">${esc(String(msg).toUpperCase())}</span><span class="cursor"></span></div>`;
}

function startStages(stages) {
  let i = 0;
  stopStages();
  newRun.stage = stages[0];
  newRun.timer = setInterval(() => {
    i = (i + 1) % stages.length;
    newRun.stage = stages[i];
    const el = document.getElementById('loadingMsg');
    if (el) el.textContent = stages[i].toUpperCase();
  }, 2600);
}
function stopStages() { if (newRun.timer) clearInterval(newRun.timer); newRun.timer = null; }

async function viewNew(errorMsg) {
  if (newRun.active) { view.innerHTML = `<div class="narrow">${loadingHTML(newRun.stage || 'Analyzing submission')}</div>`; return; }
  view.innerHTML = `<div class="narrow">
    <div class="page-head"><div><h1>New idea</h1></div><span class="mono-label">${esc(fmtDate(Date.now()))}</span></div>
    ${setupProblemHTML()}
    <form class="intake" id="intakeForm" autocomplete="off">
      <div class="field"><label for="f_name">Idea name <span class="opt">(optional)</span></label>
        <input type="text" id="f_name" maxlength="120" placeholder="e.g. RoastCall" value="${esc(formState.name)}"></div>
      <div class="field"><label for="f_idea">Describe the business idea</label>
        <textarea id="f_idea" maxlength="20000" placeholder="e.g. A subscription box that sends home baristas fresh single-origin coffee beans sourced directly from small farms, with a monthly video call from the roaster explaining the batch. Links pasted here (site, deck, competitor) are read too.">${esc(formState.idea)}</textarea></div>
      <div class="optional-grid">
        <div class="field"><label for="f_links">Links <span class="opt">(optional — site, deck, competitor)</span></label>
          <input type="text" id="f_links" placeholder="https://example.com, https://competitor.com" value="${esc(formState.links)}"></div>
        <div class="field"><label>Attachments <span class="opt">(optional, up to 3 MB total)</span></label>
          <div class="file-drop">
            <label class="file-btn" for="f_pdf">+ PDF</label><input type="file" id="f_pdf" accept="application/pdf">
            <label class="file-btn" for="f_img">+ Images</label><input type="file" id="f_img" accept="image/png,image/jpeg,image/gif,image/webp" multiple>
          </div>
          <div class="file-chips" id="fileChips"></div></div>
      </div>
      <div class="row-btn"><span class="hint">Be specific — who it's for, how it makes money, what exists today.</span>
        <button class="btn primary" type="submit" id="runBtn">Run diligence</button></div>
      <div id="formError">${errorMsg ? errorBox(errorMsg) : ''}</div>
    </form></div>`;
  renderChips();

  const form = document.getElementById('intakeForm');
  form.addEventListener('input', () => {
    formState = { name: document.getElementById('f_name').value, idea: document.getElementById('f_idea').value, links: document.getElementById('f_links').value };
  });
  form.addEventListener('submit', e => { e.preventDefault(); runNewReport(); });
  document.getElementById('f_idea').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runNewReport(); });
  document.getElementById('f_pdf').addEventListener('change', e => addFiles(Array.from(e.target.files), 'pdf', e.target));
  document.getElementById('f_img').addEventListener('change', e => addFiles(Array.from(e.target.files), 'image', e.target));
}

function totalBytes() { return (draftFiles.pdf ? draftFiles.pdf.size : 0) + draftFiles.images.reduce((n, f) => n + f.size, 0); }

function addFiles(files, kind, input) {
  const err = document.getElementById('formError');
  let msg = '';
  files.forEach(f => {
    if (kind === 'pdf') {
      if (totalBytes() - (draftFiles.pdf ? draftFiles.pdf.size : 0) + f.size > MAX_TOTAL_BYTES) { msg = `"${f.name}" would push attachments over 3 MB.`; return; }
      draftFiles.pdf = f;
    } else {
      if (draftFiles.images.length >= MAX_IMAGES) { msg = `Only ${MAX_IMAGES} images can be attached.`; return; }
      if (totalBytes() + f.size > MAX_TOTAL_BYTES) { msg = `"${f.name}" would push attachments over 3 MB.`; return; }
      draftFiles.images.push(f);
    }
  });
  input.value = '';
  err.innerHTML = msg ? errorBox(msg) : '';
  renderChips();
}

function renderChips() {
  const el = document.getElementById('fileChips');
  if (!el) return;
  const chips = [];
  if (draftFiles.pdf) chips.push({ label: '📄 ' + draftFiles.pdf.name, rm: () => { draftFiles.pdf = null; } });
  draftFiles.images.forEach((f, i) => chips.push({ label: '🖼 ' + f.name, rm: () => { draftFiles.images.splice(i, 1); } }));
  el.innerHTML = '';
  chips.forEach(c => {
    const d = document.createElement('div');
    d.className = 'file-chip';
    d.innerHTML = `<span>${esc(c.label)}</span><button type="button" aria-label="Remove">✕</button>`;
    d.querySelector('button').addEventListener('click', () => { c.rm(); renderChips(); });
    el.appendChild(d);
  });
}

function fileToItem(file, type) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ type, name: file.name, mediaType: file.type || (type === 'pdf' ? 'application/pdf' : 'image/png'), data: String(r.result).split(',')[1] });
    r.onerror = () => reject(new Error('Could not read ' + file.name));
    r.readAsDataURL(file);
  });
}

const splitLinks = raw => (raw || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);

async function runNewReport() {
  const name = formState.name.trim(), idea = formState.idea.trim(), links = splitLinks(formState.links);
  const err = document.getElementById('formError');
  if (!idea) { err.innerHTML = errorBox('Describe the idea before running diligence.'); return; }
  const problem = configProblem(settings, serverCfg);
  if (problem) { err.innerHTML = errorBox(problem + ' (Settings is in the left menu.)'); return; }

  newRun.active = true;
  startStages(LOADING_STAGES(!!(draftFiles.pdf || draftFiles.images.length), links.length > 0));
  view.innerHTML = `<div class="narrow">${loadingHTML(newRun.stage)}</div>`;

  try {
    const items = [];
    if (draftFiles.pdf) items.push(await fileToItem(draftFiles.pdf, 'pdf'));
    for (const f of draftFiles.images) items.push(await fileToItem(f, 'image'));
    const res = await api.report({ llm: llmPayload(settings), name, idea, links, attachments: items });
    const now = Date.now();
    const record = {
      id: uid(), refId: 'REF ' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      idea, ideaName: name, links,
      attachments: { pdf: items.some(i => i.type === 'pdf'), images: items.filter(i => i.type === 'image').length },
      data: res.data, sources: res.sources || [], createdAt: now, updatedAt: now, runCount: 1
    };
    await db.put('reports', record);
    if (items.length) await db.put('files', { reportId: record.id, items });
    formState = { name: '', idea: '', links: '' };
    draftFiles = { pdf: null, images: [] };
    newRun.active = false; stopStages();
    if (parseRoute().name === 'new') location.hash = '#/report/' + record.id;
    else toast(`Your report is ready: <a href="#/report/${esc(record.id)}">open it</a>`);
    updateCounts();
  } catch (e) {
    newRun.active = false; stopStages();
    if (parseRoute().name === 'new') viewNew(`Analysis failed: ${e.message}`);
    else toast('Report failed: ' + esc(e.message));
  }
}

// ---------- Reports ----------

function scoreColor(r) { return colorForScore(r.data.overall_score); }

async function viewReports() {
  const [reports, chats] = await Promise.all([db.getAll('reports'), db.getAll('chats')]);
  reports.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  const chatCount = id => chats.filter(c => c.reportId === id && c.messages && c.messages.length).length;
  view.innerHTML = `<div class="narrow">
    <div class="page-head"><h1>Reports</h1><a class="btn primary sm" href="#/new">+ New idea</a></div>
    <input class="input search" id="q" type="text" placeholder="Search by idea name…">
    <div class="list" id="rlist"></div></div>`;
  const listEl = document.getElementById('rlist');
  const draw = () => {
    const q = document.getElementById('q').value.trim().toLowerCase();
    const rows = reports.filter(r => !q || String(r.data.title || r.ideaName).toLowerCase().includes(q));
    if (!rows.length) { listEl.innerHTML = `<div class="empty">${reports.length ? 'No reports match your search.' : 'No reports yet — run your first idea.'}</div>`; return; }
    listEl.innerHTML = rows.map(r => {
      const n = chatCount(r.id);
      return `<div class="row-item" data-open="${esc(r.id)}">
        <div class="score" style="color:${scoreColor(r)}">${esc(r.data.overall_score)}</div>
        <div class="meta"><div class="ttl">${esc(r.data.title)}</div><div class="sub">${esc(fmtDate(r.updatedAt || r.createdAt))} · ${esc(r.refId)}${r.runCount > 1 ? ' · re-run ×' + (r.runCount - 1) : ''}</div></div>
        ${n ? `<span class="badge">${n} chat${n > 1 ? 's' : ''}</span>` : ''}
        <button class="btn sm danger" data-del="${esc(r.id)}" data-n="${n}" title="Delete">✕</button></div>`;
    }).join('');
  };
  draw();
  document.getElementById('q').addEventListener('input', draw);
  listEl.addEventListener('click', async e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1'; del.textContent = 'Sure?';
        setTimeout(() => { del.dataset.armed = ''; del.textContent = '✕'; }, 2500);
        return;
      }
      await db.deleteReportCascade(del.dataset.del);
      toast('Report deleted' + (+del.dataset.n ? ` along with its ${del.dataset.n} chat(s).` : '.'));
      route();
      return;
    }
    const row = e.target.closest('[data-open]');
    if (row) location.hash = '#/report/' + row.dataset.open;
  });
}

async function viewReport(id) {
  const report = await db.get('reports', id);
  if (!report) { view.innerHTML = `<div class="narrow">${errorBox('That report was not found. It may have been deleted.')}<p><a href="#/reports">← Back to reports</a></p></div>`; return; }
  const chats = (await db.chatsForReport(id)).filter(c => c.messages && c.messages.length);
  ctx = { report };
  view.innerHTML = `
    <div class="page-head">
      <div><a class="crumb" href="#/reports">← Reports</a><h1>${esc(report.data.title)}</h1></div>
      <div class="actions">
        <button class="btn primary sm" data-act="new-chat">💬 Chat with consultant</button>
        <button class="btn sm" data-act="edit-rerun">Edit &amp; re-run</button>
        <button class="btn sm" data-act="pdf-summary">Summary PDF</button>
        <button class="btn sm" data-act="pdf-full">Download PDF</button>
      </div>
    </div>
    <div id="reportErr"></div>
    <div class="report-layout">
      <div class="sheet" id="reportContent">${buildReportContentHTML(report)}</div>
      <aside class="side-card">
        <div class="sc-head"><span>Consultant</span><span>${chats.length} chat${chats.length === 1 ? '' : 's'}</span></div>
        <div class="sc-body">
          <p>Ask why this idea scored ${esc(report.data.overall_score)}, get consulting-grade advice, or explain what the report missed. Chats are attached to this report; re-running from a chat updates this same report.</p>
          ${chats.map(c => `<a class="chat-link" href="#/chat/${esc(c.id)}"><b>${esc(c.title)}</b><span>${c.messages.length} message${c.messages.length === 1 ? '' : 's'} · ${esc(fmtDate(c.updatedAt))}</span></a>`).join('')}
          <button class="btn primary sm" style="width:100%" data-act="new-chat">+ New chat</button>
        </div>
      </aside>
    </div>`;
}

async function startNewChat(reportId) {
  const chat = { id: uid(), reportId, title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  await db.put('chats', chat);
  emptyChatId = chat.id;
  location.hash = '#/chat/' + chat.id;
}

function safePdf(fn, record) {
  try { fn(record); } catch (e) { const el = document.getElementById('reportErr'); if (el) el.innerHTML = errorBox(e.message); }
}

// ---------- Re-run (always updates the same report in place) ----------

async function rerunReport(report, { name, idea, links }) {
  const files = await db.get('files', report.id);
  const res = await api.report({ llm: llmPayload(settings), name, idea, links, attachments: files ? files.items : [] });
  const prev = report.data.overall_score;
  const updated = Object.assign({}, report, {
    ideaName: name, idea, links, data: res.data, sources: res.sources || [],
    updatedAt: Date.now(), previousScore: prev, scoreDelta: res.data.overall_score - prev, runCount: (report.runCount || 1) + 1
  });
  await db.put('reports', updated); // overwritten in place: the old version is not kept
  return updated;
}

async function openRerunModal(report, chat) {
  const m = openModal(chat ? 'Re-run report from this chat' : 'Edit idea & re-run');
  const files = await db.get('files', report.id);
  const fileNote = files && files.items.length
    ? `<p class="hint" style="margin:0 0 14px">Your original attachments will be reused: ${esc(files.items.map(i => i.name || i.type).join(', '))}.</p>` : '';

  const showForm = (brief) => {
    m.locked = false;
    const changed = brief && brief.what_changed && brief.what_changed.length
      ? `<div class="mono-label" style="margin-bottom:8px">What the consultant understood</div><ul class="changes">${brief.what_changed.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : '';
    const warn = brief && brief.new_info === false
      ? `<div class="notice-box" style="margin:0 0 16px">This chat doesn't seem to add much that the report didn't already know, so a re-run will probably score about the same. Tell the consultant more first, or edit the description below.</div>` : '';
    m.body.innerHTML = `${warn}${changed}
      <div class="field"><label for="r_name">Idea name</label><input type="text" id="r_name" maxlength="120" value="${esc(brief ? brief.name : (report.ideaName || report.data.title))}"></div>
      <div class="field"><label for="r_idea">Idea description <span class="opt">(review and edit — this is what gets scored)</span></label><textarea id="r_idea" style="min-height:200px" maxlength="20000">${esc(brief ? brief.idea : report.idea)}</textarea></div>
      <div class="field"><label for="r_links">Links <span class="opt">(optional)</span></label><input type="text" id="r_links" value="${esc((brief ? brief.links.length ? brief.links : report.links : report.links || []).join(', '))}"></div>
      ${fileNote}
      <div class="notice-box" style="margin-top:0">This updates <strong>this report in place</strong>. The previous version is not kept, but the score change will be shown. Your chats stay attached.</div>
      <div id="r_err"></div>`;
    m.foot.innerHTML = `<button class="btn" data-close type="button">Cancel</button><button class="btn primary" id="r_go" type="button">Re-run report</button>`;
    document.getElementById('r_go').addEventListener('click', async () => {
      const name = document.getElementById('r_name').value.trim();
      const idea = document.getElementById('r_idea').value.trim();
      const links = splitLinks(document.getElementById('r_links').value);
      const errEl = document.getElementById('r_err');
      if (!idea) { errEl.innerHTML = errorBox('The description cannot be empty.'); return; }
      const problem = configProblem(settings, serverCfg);
      if (problem) { errEl.innerHTML = errorBox(problem); return; }
      m.locked = true;
      m.body.innerHTML = loadingHTML('Re-running the diligence');
      m.foot.innerHTML = '';
      try {
        const before = report.data.overall_score;
        const updated = await rerunReport(report, { name, idea, links });
        if (chat) {
          chat.messages.push({ id: uid(), role: 'note', kind: 'rerun', from: before, to: updated.data.overall_score, content: 'Report re-run', reportId: report.id, ts: Date.now() });
          chat.updatedAt = Date.now();
          await db.put('chats', chat);
        }
        m.close();
        toast(`Report updated: ${before} → ${updated.data.overall_score}/100`);
        route();
      } catch (e) {
        m.locked = false;
        showForm(brief);
        document.getElementById('r_name').value = name; document.getElementById('r_idea').value = idea; document.getElementById('r_links').value = links.join(', ');
        document.getElementById('r_err').innerHTML = errorBox('Re-run failed: ' + e.message + ' Your report is unchanged.');
      }
    });
  };

  if (!chat) { showForm(null); return; }

  const summarise = async () => {
    m.locked = true;
    m.body.innerHTML = loadingHTML('Summarising what the consultant now understands');
    m.foot.innerHTML = '';
    try {
      const problem = configProblem(settings, serverCfg);
      if (problem) throw new Error(problem);
      const res = await api.brief({ llm: llmPayload(settings), report: reportPayload(report), messages: chat.messages.filter(x => x.role === 'user' || x.role === 'assistant').map(({ role, content }) => ({ role, content })) });
      showForm(res.brief);
    } catch (e) {
      m.locked = false;
      m.body.innerHTML = errorBox(e.message);
      m.foot.innerHTML = `<button class="btn" data-close type="button">Close</button><button class="btn" id="r_skip" type="button">Edit the original manually</button><button class="btn primary" id="r_retry" type="button">Try again</button>`;
      document.getElementById('r_retry').addEventListener('click', summarise);
      document.getElementById('r_skip').addEventListener('click', () => showForm(null));
    }
  };
  summarise();
}

// ---------- Chat ----------

function msgHTML(m, report) {
  if (m.role === 'note') {
    const arrow = m.from === m.to ? `${esc(m.from)} → ${esc(m.to)} (no change)` : `${esc(m.from)} → ${esc(m.to)}`;
    return `<div class="note-row"><span>Report re-run · ${arrow} · <a href="#/report/${esc(m.reportId || report.id)}">view report</a></span></div>`;
  }
  const cmd = m.command ? `<span class="cmd">${esc(m.command)}</span>` : '';
  if (m.role === 'user') return `<div class="msg user"><div class="who">You${cmd}</div><div class="bubble">${esc(m.content)}</div></div>`;
  const skills = (m.skills && m.skills.length) ? `<div class="skills">Frameworks used: ${m.skills.map(s => `<span>${esc(s)}</span>`).join('')}${m.overlay ? `<span>overlay: ${esc(m.overlay)}</span>` : ''}</div>` : '';
  return `<div class="msg assistant"><div class="who">Consultant</div><div class="bubble">${renderMarkdown(m.content)}</div>${skills}</div>`;
}

async function viewChat(id) {
  const chat = await db.get('chats', id);
  const report = chat ? await db.get('reports', chat.reportId) : null;
  if (!chat || !report) { view.innerHTML = `<div class="narrow">${errorBox('That chat was not found. It may have been deleted along with its report.')}<p><a href="#/reports">← Back to reports</a></p></div>`; return; }
  ctx = { chat, report };
  const hasUserMsg = () => ctx.chat.messages.some(m => m.role === 'user');

  view.innerHTML = `<div class="chat-wrap">
    <div class="page-head"><div><a class="crumb" href="#/report/${esc(report.id)}">← Back to report</a><h1 id="chatTitle">${esc(chat.title)}</h1></div>
      <div class="actions"><button class="btn primary sm" data-act="chat-rerun" id="rerunBtn" ${hasUserMsg() ? '' : 'disabled'} title="Re-run this report using what you told the consultant">↻ Re-run report from chat</button>
      <button class="btn sm" data-act="chat-rename">Rename</button><button class="btn sm danger" data-act="chat-delete">Delete chat</button></div></div>
    ${setupProblemHTML()}
    <div id="chatBar"></div>
    <div id="intro"></div>
    <div class="thread" id="thread"></div>
    <div id="chatErr"></div>
    <div class="composer"><div class="box"><textarea id="msgInput" rows="1" maxlength="8000" placeholder="Ask about your score, explain your idea, or request a framework…"></textarea>
      <button class="btn primary" id="sendBtn" type="button">Send</button></div>
      <div class="tiny">Enter to send · Shift+Enter for a new line · The consultant reads your latest report. To change the report, re-run it from here.</div></div></div>`;

  drawChatBar();
  drawThread();

  const input = document.getElementById('msgInput');
  const send = () => { const t = input.value.trim(); if (t) { input.value = ''; autosize(); sendMessage(t); } };
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  document.getElementById('sendBtn').addEventListener('click', send);
  if (!chat.messages.length) input.focus();
}

function drawChatBar() {
  const { report } = ctx;
  const el = document.getElementById('chatBar');
  if (!el) return;
  el.innerHTML = `<div class="chat-bar"><a class="rep" href="#/report/${esc(report.id)}">
    <span class="s" style="color:${scoreColor(report)}">${esc(report.data.overall_score)}</span>
    <span class="t"><b>${esc(report.data.title)}</b><span>${esc(labelForScore(report.data.overall_score))}${typeof report.scoreDelta === 'number' ? ` · <span style="color:${colorForDelta(report.scoreDelta)}">${esc(deltaText(report.scoreDelta))}</span>` : ''}</span></span></a>
    <span class="mono-label">Chat attached to this report</span></div>`;
}

function drawThread() {
  const { chat, report } = ctx;
  const intro = document.getElementById('intro');
  const thread = document.getElementById('thread');
  if (!thread) return;
  intro.innerHTML = chat.messages.length ? '' : `<div class="intro">
    <p>I've read your report on <strong>${esc(report.data.title)}</strong> (${esc(report.data.overall_score)}/100, ${esc(labelForScore(report.data.overall_score).toLowerCase())}). Ask me why it scored this way, tell me what it got wrong, or start with a framework.</p>
    <div class="chips-label">Start with</div><div class="chips">${STARTERS.map((s, i) => `<button class="chip" type="button" data-starter="${i}">${esc(s.label)}</button>`).join('')}</div>
    <div class="chips-label">Consulting toolkit</div><div class="chips">${COMMANDS.map((c, i) => `<button class="chip" type="button" data-cmd="${i}">${esc(c.label)}</button>`).join('')}</div></div>`;
  thread.innerHTML = chat.messages.map(m => msgHTML(m, report)).join('') + (pendingChats.has(chat.id) ? `<div class="msg assistant"><div class="who">Consultant</div><div class="bubble">${loadingHTML('Thinking').replace('class="loading"', 'style="padding:0;text-align:left"')}</div></div>` : '');
  const rb = document.getElementById('rerunBtn');
  if (rb) rb.disabled = !chat.messages.some(m => m.role === 'user') || pendingChats.has(chat.id);
  const t = document.getElementById('chatTitle');
  if (t) t.textContent = chat.title;
}

async function sendMessage(text, command) {
  if (pendingChats.has(ctx.chat.id)) return;
  const { chat } = ctx;
  chat.messages.push({ id: uid(), role: 'user', content: text, ts: Date.now(), command: command || undefined });
  if (chat.title === 'New chat') { const c = COMMANDS.find(x => x.cmd === command); chat.title = c ? c.label : text.replace(/\s+/g, ' ').slice(0, 52); }
  chat.updatedAt = Date.now();
  emptyChatId = null;
  await db.put('chats', chat);
  document.getElementById('chatErr').innerHTML = '';
  await requestReply();
}

async function requestReply() {
  const { chat } = ctx;
  const err = document.getElementById('chatErr');
  err.innerHTML = '';
  const problem = configProblem(settings, serverCfg);
  if (problem) { err.innerHTML = errorBox(problem); return; }
  pendingChats.add(chat.id); drawThread(); window.scrollTo(0, document.body.scrollHeight);
  try {
    const report = (await db.get('reports', chat.reportId)) || ctx.report; // always the latest version of the report
    ctx.report = report;
    const lastUser = [...chat.messages].reverse().find(m => m.role === 'user');
    const res = await api.consult({
      llm: llmPayload(settings), report: reportPayload(report), command: lastUser && lastUser.command,
      messages: chat.messages.filter(m => m.role === 'user' || m.role === 'assistant').map(({ role, content }) => ({ role, content }))
    });
    chat.messages.push({ id: uid(), role: 'assistant', content: res.reply, ts: Date.now(), skills: res.skillsUsed, overlay: res.overlay || undefined });
    chat.updatedAt = Date.now();
    await db.put('chats', chat);
  } catch (e) {
    err.innerHTML = errorBox(e.message, ' <button class="btn sm" style="margin-left:10px" data-act="retry">Retry</button>');
  }
  pendingChats.delete(chat.id);
  if (parseRoute().name === 'chat' && ctx.chat === chat) { drawThread(); window.scrollTo(0, document.body.scrollHeight); }
  updateCounts();
}

// ---------- All chats ----------

async function viewChats() {
  const [chats, reports] = await Promise.all([db.getAll('chats'), db.getAll('reports')]);
  const byId = Object.fromEntries(reports.map(r => [r.id, r]));
  const rows = chats.filter(c => c.messages && c.messages.length && byId[c.reportId]).sort((a, b) => b.updatedAt - a.updatedAt);
  view.innerHTML = `<div class="narrow"><div class="page-head"><h1>Chats</h1></div>
    <div class="list">${rows.length ? rows.map(c => { const r = byId[c.reportId]; return `<a class="row-item" href="#/chat/${esc(c.id)}">
      <div class="score" style="color:${scoreColor(r)}">${esc(r.data.overall_score)}</div>
      <div class="meta"><div class="ttl">${esc(c.title)}</div><div class="sub">${esc(r.data.title)} · ${c.messages.length} messages · ${esc(fmtDate(c.updatedAt))}</div></div></a>`; }).join('')
      : '<div class="empty">No chats yet. Open a report and press “Chat with consultant”.</div>'}</div></div>`;
}

// ---------- Settings ----------

async function viewSettings() {
  const s = settings;
  const p = providerById(s.providerId);
  view.innerHTML = `<div class="narrow"><div class="page-head"><h1>Settings</h1></div>
    <div class="card"><h2>AI provider</h2>
      <div class="settings-grid">
        <div class="field"><label for="s_provider">Provider</label><select id="s_provider">${PROVIDERS.map(x => `<option value="${x.id}" ${x.id === s.providerId ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="s_model">Model <span class="opt">(type any model name)</span></label><input type="text" id="s_model" list="s_models" value="${esc(s.model)}" placeholder="model name" autocomplete="off"><datalist id="s_models"></datalist></div>
      </div>
      <div class="field"><label for="s_base">Base URL <span class="opt" id="s_base_opt"></span></label><input type="text" id="s_base" value="${esc(s.baseUrl || p.baseUrl)}" autocomplete="off"></div>
      <div class="field"><label for="s_key">API key</label><input type="password" id="s_key" value="${esc(s.apiKey)}" placeholder="${esc(p.keyHint || 'your key')}" autocomplete="off" spellcheck="false">
        <div class="help">Kept in this browser only. It is sent with each request through this site's server to your chosen provider, and never stored on the server.</div></div>
      <label class="check"><input type="checkbox" id="s_remember" ${s.remember ? 'checked' : ''}><span>Remember the key on this device. Untick to forget it when this tab closes.</span></label>
      <div id="s_hint"></div>
      <div class="actions" style="margin-top:6px"><button class="btn primary" id="s_save" type="button">Save settings</button><button class="btn" id="s_test" type="button">Test connection</button><span id="s_status" class="mono-label" style="align-self:center"></span></div>
    </div>
    <div class="card"><h2>Behaviour</h2>
      <div class="settings-grid">
        <div class="field"><label for="s_tokens">Max output tokens</label><input type="number" id="s_tokens" min="500" max="32000" step="500" value="${esc(s.maxTokens)}"><div class="help">Reports need roughly 4,000–6,000. Raise it for reasoning models.</div></div>
        <div class="field"><label for="s_depth">Consultant depth</label><select id="s_depth">
          <option value="compact" ${s.depth === 'compact' ? 'selected' : ''}>Compact (1 framework, small context)</option>
          <option value="standard" ${s.depth === 'standard' ? 'selected' : ''}>Standard (2 frameworks)</option>
          <option value="deep" ${s.depth === 'deep' ? 'selected' : ''}>Deep (3 frameworks, large context)</option></select><div class="help">How much of the consulting toolkit is loaded per answer. Use Compact for small local models.</div></div>
      </div>
      <label class="check" id="s_ws_row"><input type="checkbox" id="s_ws" ${s.webSearch ? 'checked' : ''}><span>Let the model search the web for competitors and market facts <span class="hint">(Anthropic only; your Anthropic account must have web search enabled)</span></span></label>
    </div>
    <div class="card"><h2>Your data</h2>
      <p class="hint" style="margin-top:0">Reports and chats live only in this browser (${esc(db.storage.mode === 'memory' ? 'storage is blocked, so they will be lost when you close the tab' : 'IndexedDB')}). Export a backup before clearing your browser data or switching devices.</p>
      <div class="actions"><button class="btn" id="d_export" type="button">Export backup</button><label class="btn" for="d_import" style="margin:0">Import backup</label><input type="file" id="d_import" accept="application/json" style="display:none"><button class="btn danger" id="d_wipe" type="button">Delete all data</button></div>
      <div id="d_msg"></div>
    </div></div>`;

  const $ = id => document.getElementById(id);
  const fillProvider = (id, keepModel) => {
    const pr = providerById(id);
    $('s_models').innerHTML = pr.models.map(m => `<option value="${esc(m)}">`).join('');
    $('s_base').placeholder = pr.custom ? 'https://your-provider.com/v1' : (pr.baseUrl || 'https://api.anthropic.com (default)');
    $('s_base_opt').textContent = pr.id === 'anthropic' ? '(leave empty for the default)' : pr.custom ? '(must be OpenAI-compatible, ending in /v1)' : '';
    $('s_ws_row').style.display = pr.type === 'anthropic' ? '' : 'none';
    $('s_key').placeholder = pr.keyHint || 'your key';
    $('s_hint').innerHTML = pr.local ? `<div class="notice-box" style="margin:0 0 14px">Local models only work when you run IdeaInspector on your own computer (<code>npm start</code>). A hosted deployment cannot reach your localhost.${pr.id === 'ollama' ? ' Start Ollama first; set Compact depth for small models.' : ''}</div>` : (pr.type === 'openai' && !pr.local ? `<div class="notice-box" style="margin:0 0 14px">Web search is only available with Anthropic. PDF attachments work only on models that accept them; images need a vision model.</div>` : '');
    if (!keepModel) { $('s_model').value = pr.models[0] || ''; $('s_base').value = pr.baseUrl; }
  };
  fillProvider(s.providerId, true);
  $('s_provider').addEventListener('change', e => fillProvider(e.target.value, false));

  const collect = () => {
    const pr = providerById($('s_provider').value);
    const base = $('s_base').value.trim();
    return {
      providerId: pr.id, baseUrl: base === pr.baseUrl && !pr.custom ? '' : base, model: $('s_model').value.trim(), apiKey: $('s_key').value.trim(),
      maxTokens: Math.min(32000, Math.max(500, parseInt($('s_tokens').value, 10) || 6000)), webSearch: $('s_ws').checked, depth: $('s_depth').value, remember: $('s_remember').checked
    };
  };
  const status = (t, ok) => { const el = $('s_status'); el.textContent = t; el.className = 'mono-label ' + (ok ? 'status-ok' : ''); };

  $('s_save').addEventListener('click', () => { settings = collect(); saveSettings(settings); status('Saved ✓', true); updateCounts(); });
  $('s_test').addEventListener('click', async () => {
    const t = collect();
    status('Testing…');
    try {
      const prob = configProblem(t, serverCfg);
      if (prob) throw new Error(prob);
      const r = await api.test({ llm: llmPayload(t) });
      status('Connected ✓ ' + (r.reply || ''), true);
    } catch (e) { status(''); $('d_msg').innerHTML = errorBox('Connection failed: ' + e.message); setTimeout(() => { const m = $('d_msg'); if (m) m.innerHTML = ''; }, 9000); }
  });
  $('d_export').addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(await db.exportAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ideainspector-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    $('d_msg').innerHTML = `<div class="notice-box">Backup downloaded. It contains your reports and chats, but not attachments or your API key.</div>`;
  });
  $('d_import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const r = await db.importAll(JSON.parse(await f.text())); $('d_msg').innerHTML = `<div class="notice-box">Imported ${r.reports} report(s) and ${r.chats} chat(s).</div>`; updateCounts(); }
    catch (err) { $('d_msg').innerHTML = errorBox(err.message || 'Could not import that file.'); }
    e.target.value = '';
  });
  let armed = false;
  $('d_wipe').addEventListener('click', async () => {
    if (!armed) { armed = true; $('d_wipe').textContent = 'Click again to delete everything'; setTimeout(() => { armed = false; const b = $('d_wipe'); if (b) b.textContent = 'Delete all data'; }, 3500); return; }
    await db.wipeAll(); clearSecrets(); settings = loadSettings(); armed = false;
    $('d_wipe').textContent = 'Delete all data'; $('d_msg').innerHTML = `<div class="notice-box">All reports, chats and your saved key were deleted from this browser.</div>`; updateCounts();
  });
}

// ---------- global click handling ----------

view.addEventListener('click', async e => {
  const el = e.target.closest('[data-act],[data-starter],[data-cmd]');
  if (!el) return;
  if (el.dataset.starter !== undefined) return sendMessage(STARTERS[+el.dataset.starter].text);
  if (el.dataset.cmd !== undefined) { const c = COMMANDS[+el.dataset.cmd]; return sendMessage(c.text, c.cmd); }
  switch (el.dataset.act) {
    case 'new-chat': return startNewChat(ctx.report.id);
    case 'edit-rerun': return openRerunModal(ctx.report, null);
    case 'pdf-full': return safePdf(exportPDF, ctx.report);
    case 'pdf-summary': return safePdf(exportSummaryPDF, ctx.report);
    case 'chat-rerun': return openRerunModal(ctx.report, ctx.chat);
    case 'retry': return requestReply();
    case 'chat-rename': {
      const t = window.prompt('Rename this chat', ctx.chat.title);
      if (t && t.trim()) { ctx.chat.title = t.trim().slice(0, 80); await db.put('chats', ctx.chat); drawThread(); }
      return;
    }
    case 'chat-delete': {
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = 'Sure?'; setTimeout(() => { el.dataset.armed = ''; el.textContent = 'Delete chat'; }, 2500); return; }
      const rid = ctx.chat.reportId;
      await db.del('chats', ctx.chat.id); emptyChatId = null;
      toast('Chat deleted.');
      location.hash = '#/report/' + rid;
    }
  }
});

// ---------- boot ----------

(async function init() {
  serverCfg = await api.config();
  await db.getAll('reports').catch(() => []);
  if (db.storage.mode === 'memory') toast('Your browser is blocking storage, so reports will be lost when you close this tab. Use Settings → Export backup.', 9000);
  if (!location.hash) location.hash = '#/new'; else route();
})();
