// A tiny fake OpenAI-compatible provider used by the tests (no real API key needed).
//   node test/mock-llm.js 9911      -> http://127.0.0.1:9911/v1
const http = require('http');

function report(score, title) {
  return {
    title, tldr: 'Mock TL;DR.', snapshot: { problem: 'P', solution: 'S', customer: 'C' }, overall_score: score, confidence: 'Medium',
    methodology_note: 'Mock methodology.', top_risk: 'Mock top risk.', score_drivers: 'Mock driver.', summary: 'Mock summary for ' + title,
    categories: [
      { name: 'Market Demand', score: 60, weight: '25%', note: 'n' }, { name: 'Differentiation', score: 30, weight: '25%', note: 'n' },
      { name: 'Feasibility', score: 55, weight: '20%', note: 'n' }, { name: 'Monetization', score: 25, weight: '20%', note: 'n' }, { name: 'Timing', score: 50, weight: '10%', note: 'n' }],
    market: { customer_profile: 'cp', market_size_note: 'ms', competitors: ['A — x <script>alert(1)</script>'], whitespace: 'w', confidence: 'Low' },
    business_model: { verdict: 'Needs Work', pricing_note: 'p', unit_economics_note: 'u', scalability_note: 's', confidence: 'Low' },
    risks: [{ category: 'Market', severity: 'High', note: 'r' }], strengths: ['a', 'b', 'c'], weaknesses: ['a', 'b', 'c'], do_list: ['a'], dont_list: ['a'],
    roadmap: [{ phase: 'This Week', action: 'act' }], comparables: [{ name: 'X', outcome: 'Failed', lesson: 'l' }],
    readiness: [{ stage: 'Seed VC', ready: 'No', note: 'n' }], final_verdict: { call: 'Go With Changes', rationale: 'because' }
  };
}

function reply(body) {
  const system = (body.messages[0] || {}).content || '';
  const userText = JSON.stringify(body.messages.slice(1));
  if (system.includes('skeptical, experienced startup analyst')) {
    return JSON.stringify(report(userText.includes('CLARIFIED') ? 58 : 38, userText.includes('CLARIFIED') ? 'Clarified Idea' : 'Mock Idea'));
  }
  if (system.includes('maintain the founder')) {
    return JSON.stringify({ name: 'Mock Idea', idea: 'CLARIFIED description: the founder explained the real product.', links: ['https://example.com'], what_changed: ['Founder explained the real product'], new_info: true });
  }
  const skills = (system.match(/### Skill: [a-z-]+/g) || []).map(s => s.replace('### Skill: ', '')).join(',');
  const overlay = (system.match(/## INDUSTRY OVERLAY: [a-z-]+/) || [''])[0];
  return `## Mock consultant answer\n\n| Item | Value |\n|---|---|\n| Skills | ${skills} |\n\n- point **one**\n- point two\n\n${overlay}\n\n<img src=x onerror=alert(1)>`;
}

function start(port) {
  return new Promise(resolve => {
    const calls = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', c => raw += c);
      req.on('end', () => {
        if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
          const body = JSON.parse(raw);
          calls.push({ auth: req.headers.authorization, body });
          if (req.headers.authorization !== 'Bearer test-key') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'bad key' } })); }
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ choices: [{ message: { content: reply(body) } }] }));
        }
        res.statusCode = 404; res.end('{}');
      });
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${port}/v1` }));
  });
}

module.exports = { start };
if (require.main === module) start(parseInt(process.argv[2] || '9911', 10)).then(m => console.log('mock LLM at ' + m.url));
