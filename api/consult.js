// POST /api/consult  { llm, report, messages[], command? }  ->  { reply, skillsUsed, overlay, sources }
const { route, BadRequest, str } = require('../lib/http');
const { resolveLLMConfig } = require('../lib/guard');
const { callLLM } = require('../lib/llm');
const { buildConsultantSystem, COMMAND_SKILLS } = require('../lib/consultant');

function cleanMessages(list) {
  if (!Array.isArray(list)) throw new BadRequest('messages must be a list.');
  let msgs = list.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: str(m.content, 12000, 'A message') }));
  msgs = msgs.slice(-30);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new BadRequest('The last message must be from you.');
  return msgs;
}

function cleanReport(r) {
  if (!r || typeof r !== 'object' || !r.data || typeof r.data !== 'object') throw new BadRequest('A report is required: chats are always attached to a report.');
  return { ideaName: str(r.ideaName, 200), idea: str(r.idea, 20000), links: Array.isArray(r.links) ? r.links.slice(0, 10).map(String) : [], attachments: r.attachments || {}, previousScore: r.previousScore, data: r.data };
}

module.exports = route(['POST'], async (body) => {
  const cfg = resolveLLMConfig(body.llm);
  const messages = cleanMessages(body.messages);
  const report = cleanReport(body.report);
  const command = typeof body.command === 'string' && COMMAND_SKILLS[body.command] ? body.command : undefined;
  const { system, skillsUsed, overlay } = buildConsultantSystem({ report, messages, command, depth: cfg.depth });
  const out = await callLLM(cfg, { system, messages });
  return { reply: out.text, skillsUsed, overlay, sources: out.sources };
});
