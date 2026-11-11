// AI provider settings, kept in this browser only.

export const PROVIDERS = [
  { id: 'anthropic',  label: 'Anthropic (Claude)',       type: 'anthropic', baseUrl: '', keyHint: 'sk-ant-...', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-4-6'], webSearch: true },
  { id: 'openai',     label: 'OpenAI',                   type: 'openai', baseUrl: 'https://api.openai.com/v1', keyHint: 'sk-...', models: ['gpt-5', 'gpt-4.1', 'gpt-4o'] },
  { id: 'gemini',     label: 'Google Gemini',            type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyHint: 'AIza...', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { id: 'openrouter', label: 'OpenRouter (any model)',   type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-...', models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'google/gemini-2.5-pro', 'meta-llama/llama-3.3-70b-instruct'] },
  { id: 'groq',       label: 'Groq',                     type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', keyHint: 'gsk_...', models: ['llama-3.3-70b-versatile'] },
  { id: 'deepseek',   label: 'DeepSeek',                 type: 'openai', baseUrl: 'https://api.deepseek.com/v1', keyHint: 'sk-...', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'mistral',    label: 'Mistral',                  type: 'openai', baseUrl: 'https://api.mistral.ai/v1', keyHint: '', models: ['mistral-large-latest'] },
  { id: 'xai',        label: 'xAI (Grok)',               type: 'openai', baseUrl: 'https://api.x.ai/v1', keyHint: 'xai-...', models: ['grok-4'] },
  { id: 'together',   label: 'Together AI',              type: 'openai', baseUrl: 'https://api.together.xyz/v1', keyHint: '', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'] },
  { id: 'ollama',     label: 'Ollama (local)',           type: 'openai', baseUrl: 'http://localhost:11434/v1', keyHint: 'not needed', keyOptional: true, local: true, models: ['llama3.1'] },
  { id: 'lmstudio',   label: 'LM Studio (local)',        type: 'openai', baseUrl: 'http://localhost:1234/v1', keyHint: 'not needed', keyOptional: true, local: true, models: [] },
  { id: 'custom',     label: 'Custom OpenAI-compatible', type: 'openai', baseUrl: '', keyHint: '', models: [], custom: true }
];

export const providerById = id => PROVIDERS.find(p => p.id === id) || PROVIDERS[0];

const KEY_SETTINGS = 'ii.settings.v2';
const KEY_SECRET = 'ii.apikey.v2';

const DEFAULTS = { providerId: 'anthropic', baseUrl: '', model: '', maxTokens: 6000, webSearch: true, depth: 'standard', remember: true };

function safeGet(store, key) { try { return store.getItem(key); } catch { return null; } }
function safeSet(store, key, val) { try { store.setItem(key, val); return true; } catch { return false; } }
function safeDel(store, key) { try { store.removeItem(key); } catch { /* ignore */ } }

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(safeGet(localStorage, KEY_SETTINGS) || '{}'); } catch { s = {}; }
  const merged = Object.assign({}, DEFAULTS, s);
  const key = safeGet(localStorage, KEY_SECRET) || safeGet(sessionStorage, KEY_SECRET) || '';
  merged.apiKey = key;
  return merged;
}

export function saveSettings(s) {
  const { apiKey, ...rest } = s;
  safeSet(localStorage, KEY_SETTINGS, JSON.stringify(rest));
  safeDel(localStorage, KEY_SECRET); safeDel(sessionStorage, KEY_SECRET);
  if (apiKey) safeSet(s.remember ? localStorage : sessionStorage, KEY_SECRET, apiKey);
}

export function clearSecrets() { safeDel(localStorage, KEY_SECRET); safeDel(sessionStorage, KEY_SECRET); }

// What gets sent with each API call.
export function llmPayload(s) {
  const p = providerById(s.providerId);
  return {
    provider: p.type,
    baseUrl: p.custom || p.id === 'anthropic' ? (s.baseUrl || '') : (s.baseUrl || p.baseUrl),
    apiKey: s.apiKey || '',
    model: s.model || '',
    maxTokens: Number(s.maxTokens) || 6000,
    webSearch: p.type === 'anthropic' && !!s.webSearch,
    depth: s.depth
  };
}

// Returns an error message when the app is not ready to call an AI, otherwise ''.
export function configProblem(s, serverCfg) {
  const p = providerById(s.providerId);
  const serverHasKey = serverCfg && serverCfg.serverKey && !s.apiKey;
  if (!s.model && !(serverCfg && serverCfg.model)) return 'Choose a model in Settings first.';
  if (!s.apiKey && !p.keyOptional && !serverHasKey) return 'Add your AI provider key in Settings first.';
  if (p.custom && !s.baseUrl) return 'Enter the base URL of your provider in Settings first.';
  return '';
}
