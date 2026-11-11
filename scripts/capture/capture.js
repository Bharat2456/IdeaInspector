// Records the README screenshots and demo video against the demo provider.
//   node scripts/capture/capture.js shots <outDir>   |   node scripts/capture/capture.js video <outDir>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const MODE = process.argv[2] || 'shots';
const OUT = process.argv[3] || path.join(__dirname, '..', '..', 'docs');
const BASE = process.env.BASE || 'http://localhost:3100';
const VIDEO = MODE === 'video';
const VIEW = VIDEO ? { width: 1280, height: 720 } : { width: 1280, height: 800 };

const SETTINGS = { providerId: 'custom', baseUrl: 'http://127.0.0.1:9912/v1', model: 'demo', maxTokens: 6000, webSearch: false, depth: 'standard', remember: true };

const NAME = 'RoastCall';
const IDEA = 'A coffee subscription app for home baristas who want fresh beans and to learn from the people who roast them.';
const CLARIFY = "I think the report misread my idea. It's actually a $39/month membership where an independent roaster hosts a live tasting each month and ships the beans directly. We keep 20%, and three roasters have signed letters of intent.";

const cursorScript = () => {
  window.addEventListener('DOMContentLoaded', () => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;z-index:99999;width:20px;height:20px;border-radius:50%;background:rgba(181,119,46,.4);border:2px solid #B5772E;pointer-events:none;transform:translate(-50%,-50%);left:-60px;top:-60px;transition:transform .12s';
    document.body.appendChild(d);
    document.addEventListener('mousemove', e => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('mousedown', () => { d.style.transform = 'translate(-50%,-50%) scale(.65)'; }, true);
    document.addEventListener('mouseup', () => { d.style.transform = 'translate(-50%,-50%)'; }, true);
  });
};

const pace = (page, ms) => (VIDEO ? page.waitForTimeout(ms) : page.waitForTimeout(80));
const shot = async (page, name, opts = {}) => { if (!VIDEO) await page.screenshot(Object.assign({ path: path.join(OUT, 'screenshots', name + '.png') }, opts)); };

async function click(page, sel) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  if (VIDEO) { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 28 }); await page.waitForTimeout(300); }
  await el.click();
}
async function type(page, sel, text) {
  await click(page, sel);
  if (VIDEO) await page.keyboard.type(text, { delay: 24 }); else await page.fill(sel, text);
}
async function scrollTo(page, y, ms = 1500) {
  if (!VIDEO) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(100); return; }
  await page.evaluate(([to, dur]) => new Promise(res => {
    const from = window.scrollY, t0 = performance.now();
    const step = now => { const k = Math.min(1, (now - t0) / dur), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; window.scrollTo(0, from + (to - from) * e); k < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  }), [y, ms]);
}

(async () => {
  fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
  const browser = await chromium.launch();
  const ctxOpts = { viewport: VIEW, deviceScaleFactor: VIDEO ? 1 : 2 };
  if (VIDEO) ctxOpts.recordVideo = { dir: path.join(OUT, '_video'), size: VIEW };
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(([s]) => { try { if (!localStorage.getItem('ii.settings.v2')) { localStorage.setItem('ii.settings.v2', JSON.stringify(s)); localStorage.setItem('ii.apikey.v2', 'demo'); } } catch (e) {} }, [SETTINGS]);
  if (VIDEO) await ctx.addInitScript(cursorScript);
  const page = await ctx.newPage();

  // 1. Landing
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  await shot(page, 'landing');
  await pace(page, 1800);
  await scrollTo(page, 760, 2600); await pace(page, 900);
  await shot(page, 'landing-features');
  await scrollTo(page, 0, 1400); await pace(page, 500);
  await click(page, '.nav a.btn.primary');

  // 2. New idea
  await page.waitForSelector('#intakeForm');
  await pace(page, 800);
  await type(page, '#f_name', NAME);
  await type(page, '#f_idea', IDEA);
  await pace(page, 500);
  await shot(page, 'new-idea');
  await click(page, '#runBtn');
  await shot(page, 'loading').catch(() => {});
  await page.waitForSelector('#reportContent .seal', { timeout: 40000 });
  await pace(page, 2200);
  await shot(page, 'report');
  await scrollTo(page, 760, 2400); await pace(page, 1200);
  await shot(page, 'report-breakdown');
  await scrollTo(page, 1650, 2400); await pace(page, 1400);
  await shot(page, 'report-market');
  await scrollTo(page, 0, 1400); await pace(page, 700);

  // 3. Consultant chat
  await click(page, '.page-head [data-act="new-chat"]');
  await page.waitForSelector('#msgInput');
  await pace(page, 1200);
  await shot(page, 'chat-start');
  await click(page, '[data-starter="0"]');
  await page.waitForSelector('.msg.assistant .skills', { timeout: 40000 });
  await pace(page, 800);
  await page.evaluate(() => document.querySelector('.msg.user').scrollIntoView({ block: 'start' }));
  await scrollTo(page, await page.evaluate(() => window.scrollY - 70), 600);
  await pace(page, 3800);
  await shot(page, 'chat-answer');

  await type(page, '#msgInput', CLARIFY);
  await pace(page, 500);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.msg.assistant .skills').length >= 2, null, { timeout: 40000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const m = document.querySelectorAll('.msg.assistant')[1]; m.scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); });
  await pace(page, 4200);
  await shot(page, 'chat-clarify');

  // 4. Re-run from chat
  await click(page, '#rerunBtn');
  await page.waitForSelector('#r_idea', { timeout: 40000 });
  await pace(page, 3200);
  if (!VIDEO) { await page.setViewportSize({ width: 1280, height: 980 }); await page.waitForTimeout(200); }
  await shot(page, 'rerun-modal');
  if (!VIDEO) await page.setViewportSize(VIEW);
  await click(page, '#r_go');
  await page.waitForSelector('.note-row', { timeout: 40000 });
  await pace(page, 1200);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await pace(page, 1800);
  await shot(page, 'chat-rerun');
  await click(page, '.note-row a');
  await page.waitForSelector('.score-delta', { timeout: 15000 });
  await page.waitForTimeout(300);
  await pace(page, 1400);
  await shot(page, 'report-updated');
  await scrollTo(page, 520, 2200); await pace(page, 2600);
  await scrollTo(page, 0, 1500); await pace(page, 1500);

  if (!VIDEO) {
    await page.goto(BASE + '/app#/reports'); await page.waitForSelector('.row-item'); await shot(page, 'reports');
    await page.goto(BASE + '/builder'); await page.waitForLoadState('networkidle'); await shot(page, 'builder');
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await m.addInitScript(([s]) => { localStorage.setItem('ii.settings.v2', JSON.stringify(s)); localStorage.setItem('ii.apikey.v2', 'demo'); }, [SETTINGS]);
    const mp = await m.newPage();
    await mp.goto(BASE + '/'); await mp.waitForLoadState('networkidle'); await mp.screenshot({ path: path.join(OUT, 'screenshots', 'mobile-landing.png') });
    await m.close();
    const rp = await ctx.newPage();
    await rp.setViewportSize({ width: 390, height: 844 });
    await rp.goto(BASE + '/app#/reports'); await rp.waitForSelector('.row-item'); await rp.click('.row-item');
    await rp.waitForSelector('.seal'); await rp.waitForTimeout(300);
    await rp.screenshot({ path: path.join(OUT, 'screenshots', 'mobile-report.png') });
    await rp.close();
    // Settings with a realistic provider and a masked placeholder key
    const s = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
    await s.addInitScript(() => { localStorage.setItem('ii.settings.v2', JSON.stringify({ providerId: 'anthropic', baseUrl: '', model: 'claude-sonnet-5-5', maxTokens: 6000, webSearch: true, depth: 'standard', remember: true })); localStorage.setItem('ii.apikey.v2', 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx'); });
    const sp = await s.newPage();
    await sp.goto(BASE + '/app#/settings'); await sp.waitForSelector('#s_provider'); await sp.screenshot({ path: path.join(OUT, 'screenshots', 'settings.png') });
    await s.close();
  }

  await ctx.close();
  if (VIDEO) {
    const f = fs.readdirSync(path.join(OUT, '_video')).find(x => x.endsWith('.webm'));
    fs.renameSync(path.join(OUT, '_video', f), path.join(OUT, 'demo.webm'));
    fs.rmdirSync(path.join(OUT, '_video'));
  }
  await browser.close();
  console.log('done', MODE);
})().catch(e => { console.error(e); process.exit(1); });
