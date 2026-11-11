// POST /api/test  { llm }  ->  { ok, reply }   (Settings -> "Test connection")
const { route } = require('../lib/http');
const { resolveLLMConfig } = require('../lib/guard');
const { callLLM } = require('../lib/llm');

module.exports = route(['POST'], async (body) => {
  const cfg = resolveLLMConfig(Object.assign({}, body.llm, { webSearch: false, maxTokens: 500 }));
  const out = await callLLM(cfg, { system: 'You are a connectivity test. Reply with the single word: OK', messages: [{ role: 'user', content: 'ping' }] });
  return { ok: true, reply: out.text.slice(0, 80) };
});
