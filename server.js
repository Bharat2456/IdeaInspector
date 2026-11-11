// IdeaInspector - local server (zero dependencies).
//   npm start  ->  http://localhost:3000
// On Vercel this file is not used: /public is served statically and /api/*.js run as serverless functions.

const http = require('http');
const fs = require('fs');
const path = require('path');

// Minimal .env loader (so no dotenv dependency is needed)
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch { /* no .env, that's fine */ }

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 6 * 1024 * 1024;

const API = {
  '/api/report': require('./api/report'),
  '/api/consult': require('./api/consult'),
  '/api/brief': require('./api/brief'),
  '/api/test': require('./api/test'),
  '/api/config': require('./api/config')
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Request too large.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function decorate(res) { // Vercel-style helpers so the same handlers run in both places
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
  return res;
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end('Forbidden'); }
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); return res.end('Not found'); }
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  decorate(res);
  Object.entries(SECURITY_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (API[pathname]) {
      if (req.method === 'POST') {
        const raw = await readBody(req);
        try { req.body = raw ? JSON.parse(raw) : {}; } catch { return res.status(400).json({ error: { message: 'Request body must be JSON.' } }); }
      }
      return await API[pathname](req, res);
    }
    if (pathname.startsWith('/api/')) return res.status(404).json({ error: { message: 'Unknown endpoint.' } });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(e.status || 500).json({ error: { message: e.message || 'Server error' } });
  }
});

server.listen(PORT, () => {
  console.log(`\nIdeaInspector is running at http://localhost:${PORT}\n`);
  if (!process.env.LLM_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.log('Tip: open the Dashboard -> Settings and paste any AI provider key. Nothing needs to be set in .env.\n');
  }
});
