// Validates the provider settings that arrive from the browser and blocks
// requests to private networks when running on a public host (SSRF protection).

const dns = require('dns').promises;
const net = require('net');

const PROVIDERS = new Set(['anthropic', 'openai']); // 'openai' = any OpenAI-compatible chat/completions API

function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true;
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIPv4(m[1]);
    return false;
  }
  return true;
}

function isHostedEnvironment() {
  return !!(process.env.VERCEL || process.env.RESTRICT_PRIVATE_HOSTS === 'true');
}

// Throws an Error with a user-friendly message when the URL must not be called.
async function assertSafeUrl(urlString) {
  let u;
  try { u = new URL(urlString); } catch { throw new Error('The base URL is not a valid URL.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The base URL must start with https://');
  if (u.username || u.password) throw new Error('The base URL must not contain credentials.');
  if (!isHostedEnvironment()) return u; // local use: allow Ollama / LM Studio on localhost

  if (u.protocol !== 'https:') throw new Error('On a hosted deployment the base URL must use https://');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Local addresses cannot be reached from a hosted deployment. Run IdeaInspector locally to use a local model.');
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => {
    throw new Error('Could not resolve the base URL host.');
  });
  if (addrs.some(a => isPrivateIP(a.address))) {
    throw new Error('That address points to a private network and is blocked on hosted deployments.');
  }
  return u;
}

function cleanString(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Normalises the `llm` settings object sent by the browser, applying optional server-side defaults from env.
function resolveLLMConfig(input) {
  input = input && typeof input === 'object' ? input : {};
  const provider = cleanString(input.provider, 20) || process.env.LLM_PROVIDER || 'anthropic';
  if (!PROVIDERS.has(provider)) throw new Error('Unknown provider type.');
  // A server-side default key is only ever used for the server's own default provider/endpoint,
  // so a caller can never point it at a host of their choosing.
  const sameDefaults = (!input.baseUrl || input.baseUrl === process.env.LLM_BASE_URL) &&
    (!input.provider || input.provider === (process.env.LLM_PROVIDER || 'anthropic'));
  const apiKey = cleanString(input.apiKey, 500) || (sameDefaults ? (process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || '') : '');
  const model = cleanString(input.model, 200) || process.env.LLM_MODEL || process.env.ANTHROPIC_MODEL || '';
  const baseUrl = cleanString(input.baseUrl, 300) || process.env.LLM_BASE_URL || '';
  let maxTokens = parseInt(input.maxTokens, 10);
  if (!Number.isFinite(maxTokens)) maxTokens = parseInt(process.env.LLM_MAX_TOKENS || process.env.ANTHROPIC_MAX_TOKENS || '6000', 10);
  maxTokens = Math.min(Math.max(maxTokens || 6000, 500), 32000);
  const webSearch = input.webSearch === true && provider === 'anthropic';
  const depth = ['compact', 'standard', 'deep'].includes(input.depth) ? input.depth : 'standard';
  if (!model) throw new Error('No model set. Open Settings and choose or type a model name.');
  return { provider, apiKey, model, baseUrl, maxTokens, webSearch, depth };
}

module.exports = { assertSafeUrl, resolveLLMConfig, isPrivateIP, PROVIDERS };
