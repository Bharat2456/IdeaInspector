// GET /api/config -> tells the UI whether the server has default credentials (never reveals them).
const { route } = require('../lib/http');

module.exports = route(['GET'], async () => ({
  serverKey: !!(process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY),
  provider: process.env.LLM_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : ''),
  model: process.env.LLM_MODEL || process.env.ANTHROPIC_MODEL || '',
  hosted: !!process.env.VERCEL
}));
