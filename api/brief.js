// POST /api/brief  { llm, report, messages[] }  ->  { brief }
// Summarises what the chat taught the consultant into an updated idea description the founder can review before re-running.
const { route, BadRequest, str } = require('../lib/http');
const { resolveLLMConfig } = require('../lib/guard');
const { callLLM, parseJSONLoose } = require('../lib/llm');
const { BRIEF_SYSTEM, buildBriefMessages } = require('../lib/consultant');

module.exports = route(['POST'], async (body) => {
  const cfg = resolveLLMConfig(Object.assign({}, body.llm, { webSearch: false }));
  const r = body.report;
  if (!r || typeof r !== 'object') throw new BadRequest('A report is required.');
  const report = { ideaName: str(r.ideaName, 200), idea: str(r.idea, 20000), links: Array.isArray(r.links) ? r.links.slice(0, 10).map(String) : [], data: r.data || {} };
  const messages = (Array.isArray(body.messages) ? body.messages : []).filter(m => m && typeof m.content === 'string').slice(-60).map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
  if (!messages.some(m => m.role === 'user')) throw new BadRequest('There is nothing in this chat to summarise yet. Tell the consultant about your idea first.');
  const out = await callLLM(cfg, { system: BRIEF_SYSTEM, messages: buildBriefMessages(report, messages) });
  const j = parseJSONLoose(out.text);
  const brief = {
    name: String(j.name || report.ideaName || '').slice(0, 120),
    idea: String(j.idea || '').slice(0, 20000),
    links: (Array.isArray(j.links) ? j.links : []).map(String).filter(l => /^https?:\/\//i.test(l)).slice(0, 10),
    what_changed: (Array.isArray(j.what_changed) ? j.what_changed : []).map(String).slice(0, 8),
    new_info: j.new_info !== false
  };
  if (!brief.idea.trim()) throw new Error('The model did not produce an updated description. Try again.');
  return { brief };
});
