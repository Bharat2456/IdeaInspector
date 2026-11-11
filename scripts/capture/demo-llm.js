// A scripted "AI provider" with a realistic demo idea, used only to record the README screenshots and video.
// Sample data: every figure and opinion below is illustrative.
const http = require('http');
const LATENCY = parseInt(process.env.DEMO_LATENCY || '2200', 10);

const base = {
  confidence: 'Medium',
  snapshot: {
    problem: 'Home coffee enthusiasts buy great beans but never meet the people who roasted them, so loyalty goes to whoever ships cheapest.',
    solution: 'A monthly membership where independent roasters host a live tasting for members and ship that month\'s beans directly.',
    customer: 'Specialty-coffee hobbyists aged 25-45 who already own a grinder and a scale.'
  }
};

const v1 = Object.assign({}, base, {
  title: 'RoastCall', overall_score: 46,
  tldr: 'Reads as another coffee subscription in a crowded category with thin margins. The live-roaster angle is hinted at but not yet a business model.',
  summary: 'A coffee subscription for home baristas. The idea touches a real hobbyist market, but as described it competes on beans and shipping, where incumbents are strong and margins are slim.',
  methodology_note: 'Scored from a two-sentence description with no pricing, traction or supply details. Market evidence is general; unit economics are inferred.',
  top_risk: 'Differentiation: nothing in the description stops a larger subscription brand from copying the offer in a quarter.',
  score_drivers: 'Evidence that people pay for access to the roaster (not the beans), plus a clear take-rate model, would lift Differentiation and Monetization the most.',
  categories: [
    { name: 'Market Demand', score: 58, weight: '25%', note: 'Specialty coffee at home is a durable hobby, but demand for another subscription is unproven.' },
    { name: 'Differentiation', score: 36, weight: '25%', note: 'Roaster video calls are mentioned once and not tied to retention or pricing.' },
    { name: 'Feasibility', score: 56, weight: '20%', note: 'Sourcing and shipping are solvable; coordinating many roasters is not addressed.' },
    { name: 'Monetization', score: 32, weight: '20%', note: 'Subscription coffee margins are thin after shipping and acquisition costs.' },
    { name: 'Timing', score: 52, weight: '10%', note: 'Neutral. Interest in specialty coffee is steady rather than surging.' }
  ],
  market: {
    customer_profile: 'Specialty-coffee hobbyists who brew at home and read about origins, roughly 25-45.',
    market_size_note: 'Large global coffee market; the addressable slice is premium home-brew subscribers, which is much smaller and not sized in the description.',
    competitors: ['Trade', 'Atlas Coffee Club', 'Blue Bottle subscriptions', 'Local roaster subscriptions'],
    whitespace: 'Direct, personal access to the roaster is rare in subscriptions, but the description does not say how it becomes a moat.',
    confidence: 'Medium'
  },
  business_model: {
    verdict: 'Weak',
    pricing_note: 'No price given. Typical subscriptions compete on a $15-$25 monthly bag.',
    unit_economics_note: 'Beans, packaging, shipping and paid acquisition leave little contribution margin per order (estimate).',
    scalability_note: 'Scales only as far as acquisition spend does; nothing compounds.',
    confidence: 'Low'
  },
  risks: [
    { category: 'Market', severity: 'High', note: 'Crowded category where customers switch on price and shipping speed.' },
    { category: 'Financial', severity: 'High', note: 'Thin margins mean paid acquisition may never pay back.' },
    { category: 'Operational', severity: 'Medium', note: 'Roaster scheduling and fulfilment quality are outside your control.' },
    { category: 'Execution', severity: 'Low', note: 'A solo founder can launch a first cohort cheaply.' }
  ],
  strengths: ['Clear hobbyist audience with real passion', 'Personal roaster contact is a genuinely different experience', 'Low cost to test with a first cohort'],
  weaknesses: ['No pricing or revenue model stated', 'Differentiation is easy to copy as described', 'No evidence yet that members value the calls'],
  do_list: ['Interview 15 home brewers about why they switch subscriptions', 'Test a paid live tasting with one roaster before building anything'],
  dont_list: ['Do not buy inventory up front', 'Do not spend on ads until retention is known'],
  roadmap: [
    { phase: 'This Week', action: 'Write the one-line offer and ask 10 hobbyists what they would pay for a monthly live tasting.' },
    { phase: '30 Days', action: 'Run one paid pilot tasting with a single roaster and 20 members.' },
    { phase: '90 Days', action: 'Measure month-two retention and decide on the take-rate model.' }
  ],
  comparables: [
    { name: 'Blue Apron', outcome: 'Mixed', lesson: 'Delivery alone produced high churn; the value has to be more than the box.' },
    { name: 'Dollar Shave Club', outcome: 'Succeeded', lesson: 'Content and brand drove acquisition more than the product did.' }
  ],
  readiness: [
    { stage: 'Angel / pre-seed', ready: 'Partial', note: 'Needs evidence of paid demand and a defined model.' },
    { stage: 'Seed VC', ready: 'No', note: 'No traction or defensibility yet.' }
  ],
  final_verdict: { call: 'Go With Changes', rationale: 'The hobbyist audience is real, but the idea needs a sharper model than "another subscription". Prove people pay for the roaster relationship first.' }
});

const v2 = Object.assign({}, base, {
  title: 'RoastCall', overall_score: 61,
  snapshot: {
    problem: 'Independent roasters have no direct, recurring relationship with the people who drink their coffee; platforms own the customer.',
    solution: 'A $39 monthly membership: members join a live tasting hosted by an independent roaster and receive that roaster\'s beans directly. RoastCall keeps 20%.',
    customer: 'Specialty-coffee hobbyists who want a relationship with a roaster, and small roasters who want recurring revenue they own.'
  },
  tldr: 'Reframed as a roaster-led membership marketplace, the idea has a real wedge: roasters own the audience, members get access, and a take rate replaces thin product margin.',
  summary: 'A membership marketplace connecting independent roasters with hobbyist members through live tastings. With three roaster letters of intent and a 20% take rate, the model is far more defensible than a plain subscription.',
  methodology_note: 'Re-scored after the founder clarified the model: $39 membership, 20% take rate, roasters ship directly, three signed letters of intent. Claims are founder-stated and unverified.',
  top_risk: 'Retention: it is unproven that members keep paying for tastings after the novelty fades.',
  score_drivers: 'Two months of paid pilot retention above 70%, and a roaster willing to run tastings without a discount, would move the score most.',
  categories: [
    { name: 'Market Demand', score: 70, weight: '25%', note: 'Two-sided demand is credible: roasters want owned audiences and hobbyists want access. Letters of intent help.' },
    { name: 'Differentiation', score: 52, weight: '25%', note: 'The roaster-owned relationship is a real wedge, but a larger platform could copy the format.' },
    { name: 'Feasibility', score: 66, weight: '20%', note: 'Direct roaster fulfilment removes inventory risk; live scheduling is manageable at pilot scale.' },
    { name: 'Monetization', score: 58, weight: '20%', note: 'A take rate on memberships beats thin product margin, but 20% must survive payment fees and support.' },
    { name: 'Timing', score: 60, weight: '10%', note: 'Creator-style memberships are now familiar to consumers.' }
  ],
  market: {
    customer_profile: 'Two sides: hobbyists (25-45) who want a relationship with a roaster, and independent roasters with 200-2,000 loyal customers.',
    market_size_note: 'Needs bottom-up sizing: number of independent roasters multiplied by realistic member counts. Not yet quantified.',
    competitors: ['Trade', 'Atlas Coffee Club', 'Patreon (roaster memberships)', 'Roaster-run Shopify subscriptions'],
    whitespace: 'Live, roaster-hosted tasting as the core product, with the roaster owning the member relationship.',
    confidence: 'Medium'
  },
  business_model: {
    verdict: 'Promising',
    pricing_note: '$39 per month, with 20% to the platform (about $7.80 per member per month before fees).',
    unit_economics_note: 'At 1,000 members the platform earns roughly $7,800 a month (estimate); acquisition is shared with roasters\' own audiences.',
    scalability_note: 'Each roaster brings its own audience, so growth compounds with every roaster added.',
    confidence: 'Medium'
  },
  risks: [
    { category: 'Market', severity: 'Medium', note: 'Members may churn once the novelty of live tastings fades.' },
    { category: 'Platform', severity: 'Medium', note: 'Roasters could take members off-platform to avoid the 20% fee.' },
    { category: 'Financial', severity: 'Medium', note: 'A 20% take rate leaves little after payment fees until volume grows.' },
    { category: 'Operational', severity: 'Low', note: 'Scheduling live events across time zones needs simple tooling.' }
  ],
  strengths: ['Two-sided model with a take rate instead of thin product margin', 'Roasters bring their own audiences', 'Three letters of intent before building'],
  weaknesses: ['Retention beyond month two is unproven', 'Disintermediation risk if roasters bypass the platform', 'Live format limits how fast each roaster can scale'],
  do_list: ['Run a 60-day paid pilot with the three roasters', 'Track month-two retention and tasting attendance'],
  dont_list: ['Do not build a custom video stack; use an existing tool', 'Do not onboard more roasters before retention is known'],
  roadmap: [
    { phase: 'This Week', action: 'Turn the three letters of intent into pilot dates and a price page.' },
    { phase: '30 Days', action: 'Launch the pilot with about 60 members across the three roasters.' },
    { phase: '90 Days', action: 'Review retention and the take rate, then decide whether to add roasters.' }
  ],
  comparables: [
    { name: 'Patreon', outcome: 'Succeeded', lesson: 'Owning the audience relationship drives retention; the platform earns a fee on top.' },
    { name: 'Blue Apron', outcome: 'Mixed', lesson: 'Delivery alone produced high churn; RoastCall adds access, which is harder to copy.' }
  ],
  readiness: [
    { stage: 'Angel / pre-seed', ready: 'Yes', note: 'Defined model and signed intent; pilot data would strengthen it.' },
    { stage: 'Seed VC', ready: 'Partial', note: 'Needs retention data and proof the take rate holds.' }
  ],
  final_verdict: { call: 'Go', rationale: 'A narrower, better-defined business than the original description. Validate retention with the pilot before raising or scaling.' }
});

const WHY = `## Your score is held back by two categories

Monetization (**32**) and Differentiation (**36**) together cost you roughly 15 points. The other three are middling, not broken.

| Category | Score | Why |
|---|---|---|
| Differentiation | 36 | The roaster call is mentioned once, never tied to price or retention |
| Monetization | 32 | No price or model, and subscription coffee margins are thin (estimate) |
| Market Demand | 58 | Real hobby, but not yet proven for *another* subscription |

**Is it fair?** Mostly, for what the report could see. It scored a two-sentence description, so it read "coffee subscription", the most crowded version of your idea.

**So what:** if the roaster call is actually the product, the description undersold it. Tell me how members pay, who ships the beans, and who owns the relationship, and we can see whether a re-run would change the picture.`;

const CLARIFY = `That changes the picture. Let me play it back:

- **Product:** a $39 monthly membership centred on a live roaster tasting, not a box of beans
- **Model:** roasters ship directly and you keep **20%**
- **Moat:** the roaster owns the member relationship, so roasters bring their own audience
- **Evidence:** three roasters have signed letters of intent

The first report treated this as a commodity subscription, which is why Differentiation and Monetization scored so low. With a take-rate marketplace the economics look different, though **retention past month two is still unproven**.

You have given me enough new facts for a meaningful re-run. Press **Re-run report from chat** above, check the updated description, and the same report will refresh.`;

const BRIEF = {
  name: 'RoastCall',
  idea: 'RoastCall is a $39-per-month membership for specialty-coffee hobbyists. Each month, an independent roaster hosts a live tasting for members and ships that month\'s beans directly to them. RoastCall keeps a 20% take rate and the roaster owns the member relationship and brings their own audience. Three independent roasters have signed letters of intent. The goal is to give roasters recurring revenue they control and give hobbyists a real relationship with the person who roasts their coffee, instead of another box of beans.',
  links: [],
  what_changed: ['It is a roaster-hosted membership, not a coffee box', '$39 per month with a 20% platform take rate', 'Roasters ship directly and own the member relationship', 'Three roasters have signed letters of intent'],
  new_info: true
};

function respond(body) {
  const system = (body.messages[0] || {}).content || '';
  const msgs = body.messages.slice(1);
  const lastUser = [...msgs].reverse().find(m => m.role === 'user');
  const text = JSON.stringify(msgs);
  if (system.includes('skeptical, experienced startup analyst')) return JSON.stringify(/roaster-hosted|\$39/.test(text) ? v2 : v1);
  if (system.includes('maintain the founder')) return JSON.stringify(BRIEF);
  const t = (lastUser && lastUser.content) || '';
  if (/misread|clarif|actually/i.test(t)) return CLARIFY;
  return WHY;
}

function start(port) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', c => raw += c);
      req.on('end', () => {
        if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
          const out = respond(JSON.parse(raw));
          return setTimeout(() => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: out } }] })); }, LATENCY);
        }
        res.statusCode = 404; res.end('{}');
      });
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
module.exports = { start };
if (require.main === module) start(parseInt(process.argv[2] || '9912', 10)).then(() => console.log('demo LLM ready'));
