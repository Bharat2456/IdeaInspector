// POST /api/report  { llm, name, idea, links[], attachments[] }  ->  { data, sources }
const { route, BadRequest, attachmentParts, str } = require('../lib/http');
const { resolveLLMConfig } = require('../lib/guard');
const { callLLM, parseJSONLoose } = require('../lib/llm');
const REPORT_SYSTEM = require('../lib/report-prompt');

module.exports = route(['POST'], async (body) => {
  const cfg = resolveLLMConfig(body.llm);
  const idea = str(body.idea, 20000, 'The idea').trim();
  const name = str(body.name, 120, 'The name').trim();
  const links = (Array.isArray(body.links) ? body.links : []).map(l => String(l).trim().slice(0, 500)).filter(Boolean).slice(0, 10);
  if (!idea) throw new BadRequest('Describe the idea before running diligence.');
  const parts = attachmentParts(body.attachments);
  const hasPdf = parts.some(p => p.type === 'pdf');
  const imageCount = parts.filter(p => p.type === 'image').length;

  let userText = '';
  if (name) userText += `Idea name: ${name}\n`;
  userText += `Description: ${idea}\n`;
  if (links.length) userText += `Reference links: ${links.join(', ')}\n`;
  if (hasPdf) userText += '(A pitch PDF is attached above.)\n';
  if (imageCount) userText += `(${imageCount} supporting image(s) attached above.)\n`;
  parts.push({ type: 'text', text: userText });

  const out = await callLLM(cfg, { system: REPORT_SYSTEM, messages: [{ role: 'user', content: parts }] });
  let data;
  try { data = parseJSONLoose(out.lastText); } catch (e1) {
    try { data = parseJSONLoose(out.text); } catch { throw e1; }
  }
  if (typeof data.overall_score !== 'number' || !Array.isArray(data.categories)) {
    throw new Error('The model replied, but not in the report format. Try again, or pick a more capable model in Settings.');
  }
  data.overall_score = Math.max(0, Math.min(100, Math.round(data.overall_score)));
  if (name) data.title = name;
  return { data, sources: out.sources };
});
