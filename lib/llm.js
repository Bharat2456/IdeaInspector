// Provider adapters. The browser sends neutral messages; this converts them for
//   - Anthropic Messages API            (provider: 'anthropic')
//   - any OpenAI-compatible chat API    (provider: 'openai': OpenAI, Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Ollama, ...)
//
// Neutral message: { role: 'user'|'assistant', content: string | Part[] }
// Part: { type:'text', text } | { type:'image', mediaType, data(base64) } | { type:'pdf', name, data(base64) }

const { assertSafeUrl } = require('./guard');

const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 280000;

class UpstreamError extends Error {
  constructor(message, status) { super(message); this.status = status || 502; }
}

function scrub(text, key) {
  if (!text) return '';
  let s = String(text);
  if (key && key.length > 6) s = s.split(key).join('[key]');
  return s.slice(0, 600);
}

function extractErrorMessage(body, key) {
  let msg = '';
  try {
    const j = JSON.parse(body);
    msg = (j.error && (j.error.message || (typeof j.error === 'string' && j.error))) || j.message || (Array.isArray(j) && j[0] && j[0].error && j[0].error.message) || '';
  } catch { /* not json */ }
  return scrub(msg || body, key);
}

async function postJSON(url, headers, body, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res, raw;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal, redirect: 'error' });
    raw = await res.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new UpstreamError('The AI provider took too long to respond.', 504);
    throw new UpstreamError('Could not reach the AI provider: ' + scrub(e.cause && e.cause.message ? e.cause.message : e.message, key), 502);
  } finally { clearTimeout(timer); }
  if (!res.ok) {
    const status = res.status === 401 || res.status === 403 ? 401 : res.status;
    throw new UpstreamError(`Provider error (${res.status}): ${extractErrorMessage(raw, key)}`, status);
  }
  try { return JSON.parse(raw); } catch { throw new UpstreamError('The provider returned something that is not JSON.', 502); }
}

// ---------- Anthropic ----------

function toAnthropicContent(content) {
  if (typeof content === 'string') return content;
  return content.map(p => {
    if (p.type === 'image') return { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } };
    if (p.type === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data } };
    return { type: 'text', text: p.text };
  });
}

function extractAnthropicSources(content) {
  const out = []; const seen = new Set();
  const add = (url, title) => {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url); out.push({ url, title: (title && String(title).trim()) || url });
  };
  (content || []).forEach(b => {
    try {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(r => add(r.url, r.title));
      if (Array.isArray(b.citations)) b.citations.forEach(c => add(c.url, c.title));
    } catch { /* ignore */ }
  });
  return out.slice(0, 6);
}

async function callAnthropic(cfg, { system, messages }) {
  const base = (cfg.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const url = base + (/\/v1$/.test(base) ? '/messages' : '/v1/messages');
  await assertSafeUrl(url);
  if (!cfg.apiKey) throw new UpstreamError('No API key set. Open Settings and add your key.', 401);
  const msgs = messages.map(m => ({ role: m.role, content: toAnthropicContent(m.content) }));
  const tools = cfg.webSearch ? [{ type: 'web_search_20250305', name: 'web_search' }] : undefined;
  let allText = []; let allContent = [];
  for (let turn = 0; turn < 4; turn++) {
    const data = await postJSON(url, { 'x-api-key': cfg.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      { model: cfg.model, max_tokens: cfg.maxTokens, system, tools, messages: msgs }, cfg.apiKey);
    const content = data.content || [];
    allContent = allContent.concat(content);
    allText = allText.concat(content.filter(b => b.type === 'text').map(b => b.text));
    if (data.stop_reason === 'pause_turn') { msgs.push({ role: 'assistant', content }); continue; }
    break;
  }
  if (!allText.length) throw new UpstreamError('The model returned no text.', 502);
  return { text: allText.join('\n').trim(), lastText: allText[allText.length - 1], sources: extractAnthropicSources(allContent) };
}

// ---------- OpenAI-compatible ----------

function toOpenAIContent(content) {
  if (typeof content === 'string') return content;
  return content.map(p => {
    if (p.type === 'image') return { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } };
    if (p.type === 'pdf') return { type: 'file', file: { filename: p.name || 'document.pdf', file_data: `data:application/pdf;base64,${p.data}` } };
    return { type: 'text', text: p.text };
  });
}

function stripThinking(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
}

async function callOpenAI(cfg, { system, messages }) {
  const base = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = base + '/chat/completions';
  const u = await assertSafeUrl(url);
  const body = {
    model: cfg.model,
    messages: [{ role: 'system', content: system }].concat(messages.map(m => ({ role: m.role, content: toOpenAIContent(m.content) })))
  };
  // OpenAI's newer models reject max_tokens; most other compatible servers expect it.
  if (u.hostname === 'api.openai.com') body.max_completion_tokens = cfg.maxTokens; else body.max_tokens = cfg.maxTokens;
  const headers = cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {};
  const data = await postJSON(url, headers, body, cfg.apiKey);
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  let text = msg && msg.content;
  if (Array.isArray(text)) text = text.map(p => p.text || '').join('');
  text = stripThinking(text);
  if (!text) throw new UpstreamError('The model returned no text (it may have run out of tokens while thinking; raise Max tokens in Settings).', 502);
  return { text, lastText: text, sources: [] };
}

async function callLLM(cfg, req) {
  return cfg.provider === 'anthropic' ? callAnthropic(cfg, req) : callOpenAI(cfg, req);
}

// Pull a JSON object out of model text (handles ```json fences, preamble, and truncated output).
function parseJSONLoose(raw) {
  let s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const first = s.indexOf('{');
  if (first < 0) throw new Error('The model did not return JSON.');
  s = s.slice(first);
  const last = s.lastIndexOf('}');
  if (last > 0) { try { return JSON.parse(s.slice(0, last + 1)); } catch { /* try salvage */ } }
  // Truncated: cut back to the last complete boundary and re-close brackets.
  const cut = Math.max(s.lastIndexOf('},'), s.lastIndexOf('"]'), s.lastIndexOf('}'));
  if (cut > 0) {
    const salvage = s.slice(0, cut + 1);
    const stack = []; let inStr = false, esc = false;
    for (const ch of salvage) {
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') stack.pop();
    }
    const suffix = stack.reverse().map(o => (o === '{' ? '}' : ']')).join('');
    try { return JSON.parse(salvage + suffix); } catch { /* fallthrough */ }
  }
  throw new Error('The response was incomplete and could not be recovered. Try again or raise Max tokens in Settings.');
}

module.exports = { callLLM, parseJSONLoose, UpstreamError };
