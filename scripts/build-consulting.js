// Packs the business-consulting skill files in /consulting into lib/consulting-data.json
// so the serverless functions can load them with a plain require() (always bundled on Vercel).
// Run: npm run build:consulting   (only needed if you edit files under /consulting)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'consulting');
const OUT = path.join(__dirname, '..', 'lib', 'consulting-data.json');

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  m[1].split(/\r?\n/).forEach(line => {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^"|"$/g, '');
  });
  return { meta, body: m[2].trim() };
}

const skills = {};
for (const dir of fs.readdirSync(path.join(ROOT, 'skills'))) {
  const f = path.join(ROOT, 'skills', dir, 'SKILL.md');
  if (!fs.existsSync(f)) continue;
  const { meta, body } = parseFrontmatter(fs.readFileSync(f, 'utf8'));
  skills[dir] = { name: meta.name || dir, description: meta.description || '', body };
}

const commands = {};
for (const file of fs.readdirSync(path.join(ROOT, 'commands'))) {
  if (!file.endsWith('.md')) continue;
  const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(ROOT, 'commands', file), 'utf8'));
  commands[file.replace(/\.md$/, '')] = { description: meta.description || '', body };
}

const overlays = {};
const ovDir = path.join(ROOT, 'references', 'industry-overlays');
for (const file of fs.readdirSync(ovDir)) {
  if (file.endsWith('.md')) overlays[file.replace(/\.md$/, '')] = fs.readFileSync(path.join(ovDir, file), 'utf8').trim();
}

const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
const persona = hooks.hooks.SessionStart[0].hooks[0].prompt;

fs.writeFileSync(OUT, JSON.stringify({ source: 'abinauv/business-consulting (MIT)', persona, skills, commands, overlays }));
console.log(`Packed ${Object.keys(skills).length} skills, ${Object.keys(commands).length} commands, ${Object.keys(overlays).length} overlays -> ${path.relative(process.cwd(), OUT)}`);
