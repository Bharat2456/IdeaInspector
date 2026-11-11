// The consultant: turns the business-consulting skill pack into a system prompt for any model.
//
// For every chat turn we
//   1. start from the pack's consultant persona,
//   2. add the full diligence report the chat belongs to,
//   3. route the question to the 1-3 most relevant consulting skills (and an industry overlay)
//      and inject their SKILL.md text, so the model applies those frameworks,
//   4. optionally add a quick-command's instructions (/swot, /market-scan, ...).

const DATA = require('./consulting-data.json');

const DEPTH = {
  compact:  { skills: 1, skillChars: 5000,  overlayChars: 0,    reportChars: 9000 },
  standard: { skills: 2, skillChars: 10000, overlayChars: 3500, reportChars: 16000 },
  deep:     { skills: 3, skillChars: 16000, overlayChars: 5000, reportChars: 24000 }
};

// Extra trigger words that matter for early-stage startup ideas (the pack's own
// descriptions are written for established companies).
const EXTRA_KEYWORDS = {
  'market-research': ['tam', 'sam', 'som', 'market size', 'demand', 'trend', 'timing', 'segment', 'addressable', 'niche', 'growth rate'],
  'competitive-analysis': ['competitor', 'competition', 'rival', 'alternative', 'differentiat', 'moat', 'incumbent', 'positioning', 'copy', 'crowded'],
  'financial-analysis': ['revenue', 'margin', 'unit economics', 'cac', 'ltv', 'burn', 'runway', 'break-even', 'breakeven', 'cost', 'profit', 'funding', 'raise', 'valuation', 'projection', 'forecast'],
  'pricing-strategy': ['price', 'pricing', 'subscription', 'freemium', 'tier', 'willingness to pay', 'monetiz', 'monetis', 'charge', 'commission', 'fee'],
  'customer-insights': ['customer', 'user', 'persona', 'interview', 'pain point', 'problem', 'retention', 'churn', 'acquisition', 'who will buy', 'validate', 'validation'],
  'strategy-frameworks': ['strategy', 'swot', 'pivot', 'business model', 'canvas', 'blue ocean', 'go-to-market', 'gtm', 'positioning', 'roadmap', 'why', 'score'],
  'risk-management': ['risk', 'regulat', 'legal', 'compliance', 'threat', 'failure', 'mitigat', 'what could go wrong'],
  'innovation-strategy': ['mvp', 'prototype', 'experiment', 'lean startup', 'innovation', 'disrupt', 'hypothesis', 'test', 'pilot'],
  'operations-analysis': ['operations', 'process', 'supply chain', 'logistics', 'fulfil', 'scale', 'feasib', 'capacity', 'vendor'],
  'digital-transformation': ['ai', 'automation', 'platform', 'software', 'app', 'tech stack', 'build vs buy', 'data', 'integration'],
  'talent-strategy': ['hire', 'hiring', 'team', 'co-founder', 'cofounder', 'recruit', 'equity', 'skills gap'],
  'deliverable-creation': ['deck', 'pitch', 'presentation', 'slides', 'memo', 'one-pager', 'executive summary', 'storyboard'],
  'data-analysis': ['data', 'analy', 'cohort', 'survey', 'statistic', 'spreadsheet', 'csv'],
  'benchmarking': ['benchmark', 'compare', 'peer', 'industry standard', 'best in class'],
  'm-and-a-strategy': ['acquire', 'acquisition', 'merger', 'exit', 'buyout'],
  'change-management': ['adoption', 'change management', 'stakeholder', 'rollout']
};

// Which skills each report category points to when that category scored worst.
const CATEGORY_SKILLS = {
  'market demand': ['market-research', 'customer-insights'],
  'differentiation': ['competitive-analysis', 'strategy-frameworks'],
  'feasibility': ['operations-analysis', 'risk-management'],
  'monetization': ['pricing-strategy', 'financial-analysis'],
  'timing': ['market-research', 'innovation-strategy']
};

// Quick commands exposed as chips in the chat, mapped to the skills that power them.
const COMMAND_SKILLS = {
  'swot': ['strategy-frameworks'],
  'market-scan': ['market-research'],
  'competitor-profile': ['competitive-analysis'],
  'customer-analysis': ['customer-insights'],
  'pricing-analysis': ['pricing-strategy'],
  'financial-model': ['financial-analysis'],
  'risk-assessment': ['risk-management'],
  'market-entry': ['market-research', 'strategy-frameworks']
};

const OVERLAY_KEYWORDS = {
  'technology-saas': ['saas', 'software', 'app', 'platform', 'api', 'ai ', 'subscription', 'startup tool', 'developer', 'cloud', 'b2b software'],
  'healthcare': ['health', 'medical', 'patient', 'clinic', 'hospital', 'pharma', 'wellness', 'telemedicine', 'doctor'],
  'financial-services': ['fintech', 'bank', 'lending', 'loan', 'insurance', 'payment', 'wallet', 'invest', 'credit', 'trading'],
  'consumer-retail': ['consumer', 'retail', 'ecommerce', 'e-commerce', 'brand', 'd2c', 'store', 'shop', 'food', 'fashion', 'subscription box', 'restaurant', 'beverage'],
  'industrial-manufacturing': ['manufactur', 'factory', 'industrial', 'hardware', 'supply chain', 'machinery', 'logistics', 'materials']
};

function descriptionKeywords(desc) {
  const m = String(desc || '').match(/mentions?:\s*([\s\S]*)$/i);
  if (!m) return [];
  return m[1].replace(/["']/g, '').split(/,|\bor\b/).map(s => s.replace(/[.]+$/, '').trim().toLowerCase()).filter(s => s.length > 2);
}

const SKILL_KEYWORDS = {};
Object.keys(DATA.skills).forEach(id => {
  SKILL_KEYWORDS[id] = Array.from(new Set(descriptionKeywords(DATA.skills[id].description).concat(EXTRA_KEYWORDS[id] || [])));
});

function countHits(haystack, kw) {
  // short keywords (<=3 chars) must match as whole words; longer ones as substrings so "regulat" matches "regulatory"
  if (kw.length <= 3) return new RegExp('(^|[^a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'g').test(haystack) ? 1 : 0;
  let n = 0, i = 0;
  while ((i = haystack.indexOf(kw, i)) !== -1 && n < 3) { n++; i += kw.length; }
  return n;
}

function weakestCategories(report) {
  const cats = (report && report.data && report.data.categories) || [];
  return cats.slice().sort((a, b) => (a.score || 0) - (b.score || 0)).slice(0, 2).map(c => String(c.name || '').toLowerCase());
}

// Returns an ordered list of skill ids to load for this turn.
function selectSkills({ recentUserText, command, report, limit }) {
  const chosen = [];
  const push = id => { if (DATA.skills[id] && !chosen.includes(id)) chosen.push(id); };
  if (command && COMMAND_SKILLS[command]) COMMAND_SKILLS[command].forEach(push);

  const text = String(recentUserText || '').toLowerCase();
  const scores = {};
  Object.keys(SKILL_KEYWORDS).forEach(id => {
    scores[id] = 3 * SKILL_KEYWORDS[id].reduce((sum, kw) => sum + countHits(text, kw), 0); // the founder's words count most
  });
  // The report's weakest categories nudge the choice, so "why is my score low?" loads the right frameworks.
  weakestCategories(report).forEach((name, i) => {
    (CATEGORY_SKILLS[name] || []).forEach((id, j) => { scores[id] = (scores[id] || 0) + (i === 0 ? 2 : 1) - (j * 0.5); });
  });
  Object.keys(scores).filter(id => scores[id] > 0).sort((a, b) => scores[b] - scores[a]).forEach(push);
  if (!chosen.length) push('strategy-frameworks');
  return chosen.slice(0, limit);
}

function pickOverlay(report, extraText) {
  const d = (report && report.data) || {};
  const hay = [report && report.idea, d.title, d.tldr, d.snapshot && Object.values(d.snapshot).join(' '), d.market && d.market.customer_profile, extraText].join(' ').toLowerCase();
  let best = null, bestScore = 0;
  Object.keys(OVERLAY_KEYWORDS).forEach(id => {
    const s = OVERLAY_KEYWORDS[id].reduce((n, kw) => n + (hay.includes(kw) ? 1 : 0), 0);
    if (s > bestScore) { best = id; bestScore = s; }
  });
  return bestScore > 0 ? best : null;
}

function truncateAtSection(text, max) {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('\n## ', max);
  const end = cut > max * 0.5 ? cut : max;
  return text.slice(0, end).trimEnd() + '\n\n[... rest of this skill omitted to save context ...]';
}

function compactReport(report, maxChars) {
  const r = report || {};
  const slim = {
    idea_name: r.ideaName || (r.data && r.data.title) || '',
    founder_description: r.idea || '',
    links: r.links || [],
    attachments: r.attachments || {},
    previous_score: typeof r.previousScore === 'number' ? r.previousScore : undefined,
    report: r.data || {}
  };
  let s = JSON.stringify(slim, null, 1);
  if (s.length > maxChars) s = JSON.stringify(slim);
  if (s.length > maxChars) s = s.slice(0, maxChars) + '\n[... truncated ...]';
  return s;
}

const CONSULTANT_RULES = `You are the IdeaInspector Consultant, a senior strategy consultant (think partner at McKinsey, BCG or Bain) embedded in a startup-idea diligence tool. You are talking to the founder of the idea below. IdeaInspector has already produced the diligence report shown in the REPORT section. You can see all of it.

YOUR JOBS
1. Explain the score. When asked why the score is what it is, walk through the report's own category scores, weights, risks, confidence and "how this was scored" note. Be specific and cite the report's fields. Never be defensive about the report and never inflate it to please the founder.
2. Consult. Apply the frameworks in the ACTIVE SKILLS section to the founder's real idea and give concrete, quantified, prioritised advice. Generic startup advice that could apply to anything is a failure.
3. Fix misunderstandings. The report was written only from what the founder submitted. If the founder says it misread the idea, do not argue and do not just agree: ask the fewest clarifying questions needed (usually 1-3), then restate your updated understanding in 2-4 lines so they can confirm or correct it. Once they have given material new facts, tell them they can press "Re-run report" (above the chat) to regenerate the report. You cannot re-run it yourself and must never claim the report or score has changed. Never invent a new score. You may say directionally what is likely to change and what is not.
4. Stay honest. A mediocre idea stays mediocre. Separate what the founder told you (unverified) from what is evidenced. Mark estimates as estimates and do not invent statistics, company names or sources. If you are unsure, say so. If a number would help, say how to get it.

STYLE
- Lead with the answer (Pyramid Principle), then the support. Use action titles that state the insight.
- Be concise: usually 150-400 words. Go longer only when the founder asks for a framework deliverable (SWOT, market scan, financial model...). Use short tables where they help comparison.
- Quantify where you can. End substantive answers with a short "So what / next step".
- Plain, warm, direct language. You are a coach with a spine, not a cheerleader.`;

function buildConsultantSystem({ report, messages, command, depth }) {
  const cfg = DEPTH[depth] || DEPTH.standard;
  const lastUser = (messages || []).filter(m => m.role === 'user').slice(-3).map(m => typeof m.content === 'string' ? m.content : '').join('\n');
  const skillIds = selectSkills({ recentUserText: lastUser, command, report, limit: cfg.skills });
  const parts = [CONSULTANT_RULES];

  parts.push('## PRINCIPLES FROM THE BUSINESS-CONSULTING PACK\n' + DATA.persona
    .split('## Available Skills')[0]
    .replace(/You are now operating as a \*\*Strategy Consultant\*\*\.[^\n]*\n*/i, '')
    .replace(/## Your Role[\s\S]*?(?=## Working Principles)/i, '')
    .trim());

  parts.push('## REPORT (the diligence report this chat is attached to)\n' + compactReport(report, cfg.reportChars));

  const skillBlocks = skillIds.map(id => `### Skill: ${id}\n${truncateAtSection(DATA.skills[id].body, cfg.skillChars)}`);
  parts.push('## ACTIVE SKILLS (use these frameworks where they fit; do not recite them)\n' + skillBlocks.join('\n\n'));

  let overlayId = null;
  if (cfg.overlayChars) {
    overlayId = pickOverlay(report, lastUser);
    if (overlayId) parts.push(`## INDUSTRY OVERLAY: ${overlayId}\n` + truncateAtSection(DATA.overlays[overlayId], cfg.overlayChars));
  }

  if (command && DATA.commands[command]) {
    const body = DATA.commands[command].body.replace(/\$ARGUMENTS/g, (report && (report.ideaName || (report.data && report.data.title))) || 'the founder\'s idea');
    parts.push(`## QUICK COMMAND REQUESTED: ${command}\nFollow this brief, applied to the founder's idea. Where the brief assumes an established company, adapt it to an early-stage startup and say which assumptions you made.\n` + truncateAtSection(body, 4000));
  }
  return { system: parts.join('\n\n'), skillsUsed: skillIds, overlay: overlayId };
}

const BRIEF_SYSTEM = `You maintain the founder's idea description for IdeaInspector, a startup diligence tool. The founder had a chat with a consultant because the report may have misunderstood or under-described their idea. Produce an UPDATED IDEA BRIEF that will be fed to the report generator in place of the original description.

STRICT RULES
- Facts come only from the founder's ORIGINAL DESCRIPTION and the FOUNDER's messages in the chat. A suggestion made by the consultant counts only if the founder clearly adopted it. Never add facts, numbers, customers or competitors nobody stated.
- Do not include scores, verdicts, advice or consultant opinions. This is a neutral description of the idea.
- Keep the founder's meaning. Where the chat corrects the original, the chat wins. Keep anything from the original that the chat did not change.
- Write a standalone description of 120-400 words in plain prose that a stranger could understand: what it is, who it is for, the problem, how it works, how it makes money, what exists today (traction, team, stage) and anything the founder said about competitors or differentiation.
- Pull out any URLs the founder mentioned into "links".

Respond with ONLY a raw JSON object, no markdown fences:
{
  "name": "short idea name (keep the original name unless the founder renamed it)",
  "idea": "the updated standalone description",
  "links": ["urls the founder mentioned, if any"],
  "what_changed": ["2-6 short bullets: what is new or corrected compared with the original description"],
  "new_info": true | false  (false if the chat added nothing materially new or different)
}`;

function transcript(messages, maxChars) {
  const lines = (messages || []).filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? 'FOUNDER' : 'CONSULTANT'}: ${m.content}`);
  let out = lines.join('\n\n');
  if (out.length > maxChars) out = '[earlier messages omitted]\n' + out.slice(out.length - maxChars);
  return out;
}

function buildBriefMessages(report, messages) {
  const text = `ORIGINAL IDEA NAME: ${report.ideaName || (report.data && report.data.title) || ''}
ORIGINAL DESCRIPTION:
${report.idea || ''}
${(report.links || []).length ? 'ORIGINAL LINKS: ' + report.links.join(', ') + '\n' : ''}
CHAT TRANSCRIPT:
${transcript(messages, 30000)}`;
  return [{ role: 'user', content: text }];
}

module.exports = { buildConsultantSystem, buildBriefMessages, BRIEF_SYSTEM, selectSkills, pickOverlay, COMMAND_SKILLS, DATA };
