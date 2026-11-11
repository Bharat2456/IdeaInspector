const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { parseJSONLoose } = require('../lib/llm');
const { isPrivateIP, resolveLLMConfig, assertSafeUrl } = require('../lib/guard');
const { selectSkills, buildConsultantSystem, DATA } = require('../lib/consultant');

async function loadUtil() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'util.js'), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}

const sampleReport = { ideaName: 'X', idea: 'A subscription box for coffee lovers', links: [], data: { title: 'X', overall_score: 40, categories: [{ name: 'Monetization', score: 20 }, { name: 'Timing', score: 50 }] } };

test('consulting pack is bundled', () => {
  assert.equal(Object.keys(DATA.skills).length, 16);
  assert.ok(DATA.commands['swot']);
  assert.ok(DATA.overlays['technology-saas']);
});

test('parseJSONLoose handles fences, preamble and truncation', () => {
  assert.deepEqual(parseJSONLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJSONLoose('Sure! Here it is: {"a":{"b":[1,2]}} thanks'), { a: { b: [1, 2] } });
  const cut = parseJSONLoose('{"a":"x","list":["one","two"],"o":{"k":"v"},"tail":"unfinis');
  assert.equal(cut.a, 'x');
  assert.throws(() => parseJSONLoose('no json here'));
});

test('private addresses are detected', () => {
  ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1'].forEach(ip => assert.ok(isPrivateIP(ip), ip));
  ['8.8.8.8', '1.1.1.1', '2606:4700::1111'].forEach(ip => assert.ok(!isPrivateIP(ip), ip));
});

test('hosted mode blocks private targets, local mode allows localhost', async () => {
  process.env.RESTRICT_PRIVATE_HOSTS = 'true';
  await assert.rejects(assertSafeUrl('https://localhost/v1'));
  await assert.rejects(assertSafeUrl('https://169.254.169.254/latest'));
  await assert.rejects(assertSafeUrl('http://api.openai.com/v1'));
  await assert.rejects(assertSafeUrl('https://user:pw@api.openai.com/v1'));
  await assertSafeUrl('https://8.8.8.8/v1');
  delete process.env.RESTRICT_PRIVATE_HOSTS;
  await assertSafeUrl('http://localhost:11434/v1');
});

test('server default key is never applied to a caller-chosen endpoint', () => {
  process.env.LLM_API_KEY = 'server-secret';
  const a = resolveLLMConfig({ provider: 'openai', baseUrl: 'https://evil.example/v1', model: 'm' });
  assert.equal(a.apiKey, '');
  const b = resolveLLMConfig({ model: 'm' });
  assert.equal(b.apiKey, 'server-secret');
  delete process.env.LLM_API_KEY;
  assert.throws(() => resolveLLMConfig({}), /model/i);
});

test('skill router follows the question and the weakest category', () => {
  assert.equal(selectSkills({ recentUserText: 'How should I price my subscription tiers?', report: sampleReport, limit: 2 })[0], 'pricing-strategy');
  assert.ok(selectSkills({ recentUserText: 'who are my competitors?', report: sampleReport, limit: 2 }).includes('competitive-analysis'));
  assert.ok(selectSkills({ recentUserText: 'hello', report: sampleReport, limit: 2 }).includes('pricing-strategy')); // weakest category is Monetization
  assert.deepEqual(selectSkills({ recentUserText: '', command: 'swot', report: null, limit: 1 }), ['strategy-frameworks']);
});

test('consultant system prompt contains report, skills, and respects depth', () => {
  const msgs = [{ role: 'user', content: 'Why is my pricing score low?' }];
  const std = buildConsultantSystem({ report: sampleReport, messages: msgs, depth: 'standard' });
  const compact = buildConsultantSystem({ report: sampleReport, messages: msgs, depth: 'compact' });
  assert.ok(std.system.includes('A subscription box for coffee lovers'));
  assert.ok(std.system.includes('### Skill: pricing-strategy'));
  assert.equal(std.skillsUsed.length, 2);
  assert.equal(compact.skillsUsed.length, 1);
  assert.ok(compact.system.length < std.system.length);
  const cmd = buildConsultantSystem({ report: sampleReport, messages: msgs, command: 'swot', depth: 'standard' });
  assert.ok(cmd.system.includes('QUICK COMMAND REQUESTED: swot'));
  assert.ok(!cmd.system.includes('$ARGUMENTS'));
});

test('markdown renderer escapes HTML and renders tables/lists/links', async () => {
  const { renderMarkdown, esc } = await loadUtil();
  const html = renderMarkdown('# Title\n\n<img src=x onerror=alert(1)> **bold** [ok](https://a.com) [bad](javascript:alert(1))\n\n- a\n- b\n\n| H1 | H2 |\n|---|---|\n| 1 | 2 |\n\n`<b>`');
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('<a href="https://a.com"'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('<li>a</li>') && html.includes('<table>'));
  assert.ok(html.includes('<code>&lt;b&gt;</code>'));
  assert.equal(esc('<&"\'>'), '&lt;&amp;&quot;&#39;&gt;');
});
