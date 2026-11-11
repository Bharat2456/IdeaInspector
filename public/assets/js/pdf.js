// PDF export: the original IdeaInspector MiniPDF writer (no external library) and the two export layouts.
import { labelForScore } from './render.js';

export function MiniPDF(){
  const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 48;
  const FONT_KEYS = { helv:'F1', helvB:'F2', times:'F3', timesB:'F4', cour:'F5' };
  const FONT_BASE = { F1:'Helvetica', F2:'Helvetica-Bold', F3:'Times-Roman', F4:'Times-Bold', F5:'Courier' };
  const CHAR_W = { helv:0.52, helvB:0.55, times:0.48, timesB:0.5, cour:0.6 };
  let pages = [];
  let cur = null;
  function newPage(){
    cur = { ops: [], links: [] };
    pages.push(cur);
    return cur;
  }
  function esc(s){
    return String(s)
      .replace(/[—–]/g,'-').replace(/[’‘]/g,"'").replace(/[“”]/g,'"')
      .replace(/…/g,'...').replace(/₹/g,'Rs ')
      .replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')
      .split('').map(c => c.charCodeAt(0) > 255 ? '?' : c).join('');
  }
  function textWidth(str, font, size){
    return str.length * size * (CHAR_W[font]||0.5);
  }
  function wrap(str, font, size, maxW){
    const words = String(str).split(/\s+/);
    const lines = []; let line = '';
    words.forEach(w => {
      const test = line ? line + ' ' + w : w;
      if(textWidth(test, font, size) > maxW && line){
        lines.push(line); line = w;
      } else {
        line = test;
      }
    });
    if(line) lines.push(line);
    return lines;
  }
  function rgb(c){ return c.map(v => (v/255).toFixed(3)).join(' '); }

  function op(s){ cur.ops.push(s); }
  function setFillColor(c){ op(rgb(c) + ' rg'); }
  function setStrokeColor(c){ op(rgb(c) + ' RG'); }

  function text(str, x, y, font, size, color){
    op('BT');
    op('/' + FONT_KEYS[font] + ' ' + size + ' Tf');
    setFillColor(color);
    op('1 0 0 1 ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' Tm');
    op('(' + esc(str) + ') Tj');
    op('ET');
  }
  function rect(x, y, w, h, color){
    setFillColor(color);
    op(x.toFixed(2) + ' ' + y.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re f');
  }
  function lineH(x1, y1, x2, y2, color, width){
    setStrokeColor(color);
    op((width||1) + ' w');
    op(x1.toFixed(2) + ' ' + y1.toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' l S');
  }
  function circleStroke(cx, cy, r, color, width){
    const k = 0.5523 * r;
    setStrokeColor(color);
    op((width||1) + ' w');
    op((cx+r).toFixed(2)+' '+cy.toFixed(2)+' m');
    op([cx+r,cy+k, cx+k,cy+r, cx,cy+r].map(v=>v.toFixed(2)).join(' ')+' c');
    op([cx-k,cy+r, cx-r,cy+k, cx-r,cy].map(v=>v.toFixed(2)).join(' ')+' c');
    op([cx-r,cy-k, cx-k,cy-r, cx,cy-r].map(v=>v.toFixed(2)).join(' ')+' c');
    op([cx+k,cy-r, cx+r,cy-k, cx+r,cy].map(v=>v.toFixed(2)).join(' ')+' c');
    op('S');
  }
  function link(x, y, w, h, url){
    if(!/^https?:\/\//i.test(url)) return; // only allow safe, well-formed http(s) URLs
    cur.links.push({ x, y, w, h, url: url.replace(/[()\\]/g, '') });
  }

  function build(meta){
    meta = meta || {};
    const objs = [];
    function add(s){ objs.push(s); return objs.length; }
    let nextNum = 3;
    const fontNums = {};
    Object.keys(FONT_BASE).forEach(k => {
      fontNums[k] = nextNum++;
    });
    const pageNums = [];
    const contentNums = [];
    pages.forEach(() => {
      pageNums.push(nextNum++);
      contentNums.push(nextNum++);
    });
    const linkNumsPerPage = pages.map(p => (p.links||[]).map(() => nextNum++));
    const infoNum = nextNum++;

    const bodyObjs = {};
    bodyObjs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const kids = pageNums.map(n => n + ' 0 R').join(' ');
    bodyObjs[2] = '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>';
    Object.keys(FONT_BASE).forEach(k => {
      bodyObjs[fontNums[k]] = '<< /Type /Font /Subtype /Type1 /BaseFont /' + FONT_BASE[k] + ' >>';
    });
    const fontResource = '<< ' + Object.keys(FONT_KEYS).map(k => '/' + FONT_KEYS[k] + ' ' + fontNums[FONT_KEYS[k]] + ' 0 R').join(' ') + ' >>';
    pages.forEach((p, i) => {
      const stream = p.ops.join('\n');
      const annotsArr = linkNumsPerPage[i];
      const annotsStr = annotsArr.length ? ' /Annots [' + annotsArr.map(n=>n+' 0 R').join(' ') + ']' : '';
      bodyObjs[pageNums[i]] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] /Resources << /Font ' + fontResource + ' >> /Contents ' + contentNums[i] + ' 0 R' + annotsStr + ' >>';
      bodyObjs[contentNums[i]] = { stream };
      (p.links||[]).forEach((lk, li) => {
        const num = linkNumsPerPage[i][li];
        const rect = [lk.x, lk.y, lk.x+lk.w, lk.y+lk.h].map(v=>v.toFixed(2)).join(' ');
        bodyObjs[num] = '<< /Type /Annot /Subtype /Link /Rect [' + rect + '] /Border [0 0 0] /A << /Type /Action /S /URI /URI (' + lk.url + ') >> >>';
      });
    });
    function escMeta(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)'); }
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const pdfDate = 'D:' + now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    bodyObjs[infoNum] = '<< /Title (' + escMeta(meta.title || 'IdeaInspector Diligence Memo') + ') /Author (IdeaInspector) /Producer (IdeaInspector) /CreationDate (' + pdfDate + ') >>';

    let out = '%PDF-1.4\n';
    const offsets = {};
    const maxNum = nextNum - 1;
    for(let n = 1; n <= maxNum; n++){
      offsets[n] = out.length;
      const b = bodyObjs[n];
      if(typeof b === 'string'){
        out += n + ' 0 obj\n' + b + '\nendobj\n';
      } else {
        const s = b.stream;
        out += n + ' 0 obj\n<< /Length ' + s.length + ' >>\nstream\n' + s + '\nendstream\nendobj\n';
      }
    }
    const xrefStart = out.length;
    out += 'xref\n0 ' + (maxNum+1) + '\n';
    out += '0000000000 65535 f \n';
    for(let n = 1; n <= maxNum; n++){
      out += String(offsets[n]).padStart(10,'0') + ' 00000 n \n';
    }
    out += 'trailer\n<< /Size ' + (maxNum+1) + ' /Root 1 0 R /Info ' + infoNum + ' 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';
    return out;
  }

  function pageCount(){ return pages.length; }
  function gotoPage(i){ cur = pages[i-1]; }

  return { PAGE_W, PAGE_H, MARGIN, newPage, text, rect, lineH, circleStroke, link, wrap, textWidth, build, pageCount, gotoPage };
}

function hexColorForScore(s){
  if(s>=70) return [63,107,82];   // good
  if(s>=45) return [181,119,46];  // accent
  return [163,64,43];             // risk
}

function pdfBytesFromString(pdfString){
  const bytes = new Uint8Array(pdfString.length);
  for(let i=0;i<pdfString.length;i++) bytes[i] = pdfString.charCodeAt(i) & 0xFF;
  return bytes;
}
function downloadPdfBlob(pdfString, filename){
  const blob = new Blob([pdfBytesFromString(pdfString)], {type:'application/pdf'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function safeFilenamePart(title){
  return (title || 'idea-report').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
}

export function exportPDF(record){
  try{
    const data = record.data;
    const pdf = MiniPDF();
    const M = pdf.MARGIN, W = pdf.PAGE_W, H = pdf.PAGE_H, CW = W - M*2;
    const INK=[20,23,31], MUTED=[107,102,86], RULE=[201,194,174], BG=[239,234,221];
    const GOOD=[63,107,82], ACCENT=[181,119,46], RISKC=[163,64,43];
    const scoreColor = hexColorForScore(data.overall_score);
    pdf.newPage();
    let y = H - M;

    function ensure(need){
      if(y - need < M){
        pdf.newPage();
        y = H - M;
      }
    }
    function writeBlock(str, font, size, color, opts){
      opts = opts || {};
      const lines = pdf.wrap(str, font, size, opts.width || CW);
      lines.forEach(line => {
        ensure(size*1.4);
        y -= size*1.1;
        pdf.text(line, opts.x || M, y, font, size, color);
      });
      y -= (opts.gapAfter !== undefined ? opts.gapAfter : 4);
      return lines.length;
    }
    function sectionHeader(label, confColor, confLabel){
      ensure(20);
      pdf.text(label.toUpperCase(), M, y, 'cour', 9, MUTED);
      if(confColor && confLabel){
        const lbl = (confLabel + ' Confidence').toUpperCase();
        pdf.text(lbl, W - M - pdf.textWidth(lbl,'cour',7.5), y, 'cour', 7.5, confColor);
      }
      y -= 16;
    }
    function hrLine(){
      y -= 2; ensure(4); pdf.lineH(M, y, W-M, y, RULE, 0.75); y -= 20;
    }
    function colorForSev(sev){
      const s = String(sev||'').toLowerCase();
      if(s==='high') return RISKC;
      if(s==='medium') return ACCENT;
      return GOOD;
    }
    function colorForBiz(v){
      const s = String(v||'').toLowerCase();
      if(s.includes('strong')||s.includes('good')) return GOOD;
      if(s.includes('weak')||s.includes('bad')) return RISKC;
      return ACCENT;
    }
    function colorForCall(c){
      const s = String(c||'').toLowerCase();
      if(s==='go') return GOOD;
      if(s==='pass') return RISKC;
      return ACCENT;
    }
    function colorForConf(c){
      const s = String(c||'').toLowerCase();
      if(s==='high') return GOOD;
      if(s==='low') return RISKC;
      return ACCENT;
    }
    function colorForOut(o){
      const s = String(o||'').toLowerCase();
      if(s.includes('succ')) return GOOD;
      if(s.includes('fail')) return RISKC;
      return ACCENT;
    }
    function colorForReady(r){
      const s = String(r||'').toLowerCase();
      if(s==='yes') return GOOD;
      if(s==='no') return RISKC;
      return ACCENT;
    }

    // Masthead
    pdf.text('IdeaInspector', M, y, 'timesB', 20, INK);
    pdf.text('DILIGENCE MEMO', W - M - pdf.textWidth('DILIGENCE MEMO','cour',9), y+2, 'cour', 9, MUTED);
    y -= 10;
    pdf.lineH(M, y, W-M, y, INK, 1.5);
    y -= 20;
    pdf.text(new Date((record.updatedAt||record.createdAt)).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}), M, y, 'cour', 9, MUTED);
    pdf.text(record.refId, W - M - pdf.textWidth(record.refId,'cour',9), y, 'cour', 9, MUTED);
    y -= 26;

    // Score seal + verdict text
    const cx = M + 32, cy = y - 24, r = 28;
    pdf.circleStroke(cx, cy, r, RULE, 6);
    pdf.circleStroke(cx, cy, r, scoreColor, 4);
    const scoreStr = String(data.overall_score);
    pdf.text(scoreStr, cx - pdf.textWidth(scoreStr,'timesB',18)/2, cy+4, 'timesB', 18, scoreColor);
    pdf.text('OUT OF 100', cx - pdf.textWidth('OUT OF 100','cour',6)/2, cy-10, 'cour', 6, MUTED);

    const tx = M + 78, tw = CW - 78;
    let ty = y - 4;
    const label = labelForScore(data.overall_score).toUpperCase();
    pdf.text(label, tx, ty, 'cour', 8.5, scoreColor);
    ty -= 16;
    pdf.wrap(data.title, 'timesB', 13, tw).forEach(l => { pdf.text(l, tx, ty, 'timesB', 13, INK); ty -= 15; });
    ty -= 3;
    pdf.wrap(data.summary, 'helv', 9.5, tw).forEach(l => { pdf.text(l, tx, ty, 'helv', 9.5, [60,60,58]); ty -= 12; });
    if(typeof record.scoreDelta === 'number'){
      ty -= 4;
      const deltaColor = record.scoreDelta > 0 ? GOOD : record.scoreDelta < 0 ? RISKC : MUTED;
      const deltaTxt = (record.scoreDelta > 0 ? '+' + record.scoreDelta : String(record.scoreDelta)) + ' vs last run (was ' + record.previousScore + '/100)';
      pdf.text(deltaTxt, tx, ty, 'cour', 8, deltaColor);
      ty -= 12;
    }

    y = Math.min(y - 70, ty) - 16;

    // Methodology / confidence
    if(data.methodology_note || data.confidence){
      ensure(40);
      pdf.rect(M, y-2, CW, 2, RULE);
      y -= 14;
      const noteText = 'How this was scored: ' + (data.methodology_note||'');
      const cfColor = colorForConf(data.confidence);
      writeBlock(noteText, 'helv', 8.5, [70,70,66], {gapAfter:2});
      if(data.confidence){
        pdf.text((data.confidence + ' Confidence').toUpperCase(), M, y, 'cour', 7.5, cfColor);
        y -= 10;
      }
      y -= 10;
    }

    // Top risk / score drivers callouts
    if(data.top_risk || data.score_drivers){
      ensure(40);
      if(data.top_risk){
        pdf.rect(M, y-2, 2.5, 2, RISKC); // small marker, real bar drawn below
        pdf.lineH(M, y+8, M, y-24, RISKC, 2.5);
        pdf.text('BIGGEST RISK TO SOLVE FIRST', M+10, y, 'cour', 7.5, MUTED);
        y -= 12;
        writeBlock(data.top_risk, 'helv', 9, [40,40,38], {x:M+10, width:CW-10, gapAfter:6});
      }
      if(data.score_drivers){
        ensure(30);
        pdf.lineH(M, y+8, M, y-24, GOOD, 2.5);
        pdf.text('WHAT WOULD MOVE THE SCORE', M+10, y, 'cour', 7.5, MUTED);
        y -= 12;
        writeBlock(data.score_drivers, 'helv', 9, [40,40,38], {x:M+10, width:CW-10, gapAfter:6});
      }
      y -= 6;
    }

    // TL;DR
    if(data.tldr){
      ensure(30);
      y -= 6;
      pdf.rect(M, y-24, CW, 30, INK);
      pdf.text('TL;DR', M+10, y-2, 'cour', 7.5, [230,225,210]);
      writeBlock(data.tldr, 'timesB', 10.5, [246,243,236], {x:M+10, width:CW-20, gapAfter:0});
      y -= 12;
    }

    // Snapshot
    if(data.snapshot){
      ensure(50);
      const colW = (CW - 16) / 3;
      const items = [['PROBLEM', data.snapshot.problem], ['SOLUTION', data.snapshot.solution], ['CUSTOMER', data.snapshot.customer]];
      const startY = y;
      let maxDrop = 0;
      items.forEach((it, i) => {
        const x = M + i*(colW+8);
        pdf.text(it[0], x, y, 'cour', 8, MUTED);
        let yy = y - 12;
        pdf.wrap(it[1]||'', 'helv', 8.5, colW).forEach(l => { pdf.text(l, x, yy, 'helv', 8.5, [40,40,38]); yy -= 11; });
        maxDrop = Math.max(maxDrop, startY - yy);
      });
      y -= (maxDrop + 16);
    }

    hrLine();

    // Category breakdown
    sectionHeader('Category Breakdown');
    (data.categories||[]).forEach(cat => {
      ensure(40);
      const cc = hexColorForScore(cat.score);
      const nameLbl = cat.name + (cat.weight ? '  (' + cat.weight + ')' : '');
      pdf.text(nameLbl, M, y, 'helvB', 10.5, INK);
      const scoreLbl = cat.score + '/100';
      pdf.text(scoreLbl, W-M-pdf.textWidth(scoreLbl,'cour',9.5), y, 'cour', 9.5, MUTED);
      y -= 10;
      pdf.rect(M, y-4, CW, 5, BG);
      pdf.rect(M, y-4, CW*(cat.score/100), 5, cc);
      y -= 14;
      writeBlock(cat.note, 'helv', 9, [70,70,66], {gapAfter:8});
    });
    hrLine();

    // Market & competition
    if(data.market){
      const mConf = data.market.confidence ? colorForConf(data.market.confidence) : null;
      sectionHeader('Market & Competition', mConf, data.market.confidence);
      if(data.market.customer_profile) writeBlock('Target Customer: ' + data.market.customer_profile, 'helv', 9.5, [40,40,38], {gapAfter:6});
      if(data.market.market_size_note) writeBlock('Market Size: ' + data.market.market_size_note, 'helv', 9.5, [40,40,38], {gapAfter:6});
      if(data.market.competitors && data.market.competitors.length) writeBlock('Competitors: ' + data.market.competitors.join(' | '), 'helv', 9.5, [40,40,38], {gapAfter:6});
      if(data.market.whitespace) writeBlock('Whitespace: ' + data.market.whitespace, 'helv', 9.5, [40,40,38], {gapAfter:6});
      if((data.market.competitors && data.market.competitors.length) || data.market.market_size_note){
        const freshNote = 'Figures and competitor details reflect public information as of ' + new Date((record.updatedAt||record.createdAt)).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}) + ' — verify before relying on them.';
        writeBlock(freshNote, 'helv', 7.5, MUTED, {gapAfter:6});
      }
      hrLine();
    }

    // Business model
    if(data.business_model){
      const bConf = data.business_model.confidence ? colorForConf(data.business_model.confidence) : null;
      sectionHeader('Business Model & Revenue', bConf, data.business_model.confidence);
      const bc = colorForBiz(data.business_model.verdict);
      ensure(14);
      pdf.text((data.business_model.verdict||'').toUpperCase(), M, y, 'helvB', 10, bc);
      y -= 16;
      if(data.business_model.pricing_note) writeBlock('Pricing: ' + data.business_model.pricing_note, 'helv', 9.5, [40,40,38], {gapAfter:6});
      if(data.business_model.unit_economics_note) writeBlock('Unit Economics: ' + data.business_model.unit_economics_note, 'helv', 9.5, [40,40,38], {gapAfter:6});
      if(data.business_model.scalability_note) writeBlock('Scalability: ' + data.business_model.scalability_note, 'helv', 9.5, [40,40,38], {gapAfter:6});
      hrLine();
    }

    // Risk register
    if(data.risks && data.risks.length){
      sectionHeader('Risk Register');
      data.risks.forEach(r => {
        ensure(20);
        const sc = colorForSev(r.severity);
        pdf.text((r.severity||'').toUpperCase(), M, y, 'cour', 8, sc);
        pdf.text(r.category||'', M+70, y, 'helvB', 9.5, INK);
        y -= 12;
        writeBlock(r.note||'', 'helv', 9, [70,70,66], {gapAfter:6});
      });
      hrLine();
    }

    // Strengths / Weaknesses
    sectionHeader('Strengths & Weaknesses');
    pdf.text('STRENGTHS', M, y, 'cour', 9, GOOD);
    y -= 16;
    (data.strengths||[]).forEach(s => writeBlock('+ ' + s, 'helv', 9.5, [40,40,38], {gapAfter:4}));
    y -= 8;
    ensure(16);
    pdf.text('WEAKNESSES', M, y, 'cour', 9, RISKC);
    y -= 16;
    (data.weaknesses||[]).forEach(s => writeBlock('- ' + s, 'helv', 9.5, [40,40,38], {gapAfter:4}));
    hrLine();

    // Do / Don't
    if(data.do_list || data.dont_list){
      sectionHeader("What To Do / What Not To Do");
      if(data.do_list && data.do_list.length){
        pdf.text('DO', M, y, 'cour', 9, GOOD);
        y -= 16;
        data.do_list.forEach(s => writeBlock('+ ' + s, 'helv', 9.5, [40,40,38], {gapAfter:4}));
        y -= 6;
      }
      if(data.dont_list && data.dont_list.length){
        ensure(16);
        pdf.text("DON'T", M, y, 'cour', 9, RISKC);
        y -= 16;
        data.dont_list.forEach(s => writeBlock('- ' + s, 'helv', 9.5, [40,40,38], {gapAfter:4}));
      }
      hrLine();
    }

    // Roadmap
    if(data.roadmap && data.roadmap.length){
      sectionHeader('Next-Step Roadmap');
      data.roadmap.forEach(step => {
        ensure(20);
        pdf.text((step.phase||'').toUpperCase(), M, y, 'cour', 8, ACCENT);
        y -= 12;
        writeBlock(step.action||'', 'helv', 9.5, [40,40,38], {gapAfter:8});
      });
      hrLine();
    } else if(data.improvements){
      sectionHeader('Where To Improve');
      data.improvements.forEach((imp,i) => {
        ensure(16);
        pdf.text(String(i+1).padStart(2,'0'), M, y, 'timesB', 11, scoreColor);
        writeBlock(imp, 'helv', 9.5, [40,40,38], {x: M+26, width: CW-26, gapAfter:8});
      });
      hrLine();
    }

    // Comparables
    if(data.comparables && data.comparables.length){
      sectionHeader('Comparable Companies');
      data.comparables.forEach(c => {
        ensure(20);
        pdf.text(c.name||'', M, y, 'helvB', 10, INK);
        const oc = colorForOut(c.outcome);
        pdf.text((c.outcome||'').toUpperCase(), W-M-pdf.textWidth((c.outcome||'').toUpperCase(),'cour',8), y, 'cour', 8, oc);
        y -= 12;
        writeBlock(c.lesson||'', 'helv', 9, [70,70,66], {gapAfter:8});
      });
      hrLine();
    }

    // Investor readiness gate
    if(data.readiness && data.readiness.length){
      sectionHeader('Investor Readiness');
      data.readiness.forEach(rd => {
        ensure(20);
        const rc = colorForReady(rd.ready);
        pdf.text(rd.stage||'', M, y, 'helvB', 9.5, INK);
        pdf.text((rd.ready||'').toUpperCase(), W-M-pdf.textWidth((rd.ready||'').toUpperCase(),'cour',8), y, 'cour', 8, rc);
        y -= 12;
        writeBlock(rd.note||'', 'helv', 9, [70,70,66], {gapAfter:6});
      });
      hrLine();
    }

    // Final verdict
    if(data.final_verdict){
      ensure(50);
      const fc = colorForCall(data.final_verdict.call);
      const boxTop = y;
      const callLbl = data.final_verdict.call || '';
      pdf.text('FINAL VERDICT', M, y, 'cour', 8.5, MUTED);
      y -= 18;
      pdf.text(callLbl.toUpperCase(), M, y, 'timesB', 15, fc);
      y -= 16;
      writeBlock(data.final_verdict.rationale||'', 'helv', 9.5, [40,40,38], {gapAfter:0});
      pdf.lineH(M, boxTop+6, M, y-4, fc, 2.5);
      hrLine();
    }

    // Sources
    if(record.sources && record.sources.length){
      sectionHeader('Sources');
      record.sources.forEach(s => {
        ensure(14);
        const startY = y;
        writeBlock(s.title, 'helv', 8, ACCENT, {gapAfter:2});
        pdf.link(M, y+2, CW, startY - y + 4, s.url);
      });
      hrLine();
    }

    ensure(24);
    pdf.text('Automated first-pass diligence - not investment advice.', M, y, 'cour', 8, MUTED);
    y -= 11;
    pdf.text('Generated by IdeaInspector on ' + new Date((record.updatedAt||record.createdAt)).toLocaleString('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) + '.', M, y, 'cour', 7.5, MUTED);

    const evidenceBits = [];
    if(record.links && record.links.length) evidenceBits.push(record.links.length + ' link(s): ' + record.links.join(', '));
    if(record.attachments){
      if(record.attachments.pdf) evidenceBits.push('1 PDF attached');
      if(record.attachments.images) evidenceBits.push(record.attachments.images + ' image(s) attached');
    }
    if(evidenceBits.length){
      y -= 12;
      writeBlock('Submitted with: ' + evidenceBits.join(' | '), 'cour', 7.5, MUTED, {gapAfter:0});
    }

    // Page footers — added last, once total page count is known
    const totalPages = pdf.pageCount();
    for(let p = 1; p <= totalPages; p++){
      pdf.gotoPage(p);
      const footerLbl = 'Page ' + p + ' of ' + totalPages;
      pdf.text(footerLbl, W - M - pdf.textWidth(footerLbl,'cour',7.5), M - 20, 'cour', 7.5, MUTED);
      pdf.text('IdeaInspector', M, M - 20, 'cour', 7.5, MUTED);
    }

    downloadPdfBlob(pdf.build({title: data.title}), `ideainspector-${safeFilenamePart(data.title)}.pdf`);
  }catch(e){ console.error(e); throw new Error('Could not generate the PDF: ' + e.message); }
}

export function exportSummaryPDF(record){
  try{
    const data = record.data;
    const pdf = MiniPDF();
    const M = pdf.MARGIN, W = pdf.PAGE_W, H = pdf.PAGE_H, CW = W - M*2;
    const INK=[20,23,31], MUTED=[107,102,86], RULE=[201,194,174];
    const GOOD=[63,107,82], ACCENT=[181,119,46], RISKC=[163,64,43];
    const scoreColor = hexColorForScore(data.overall_score);
    pdf.newPage();
    let y = H - M;

    function writeBlock(str, font, size, color, opts){
      opts = opts || {};
      const lines = pdf.wrap(str, font, size, opts.width || CW);
      lines.forEach(line => {
        y -= size*1.1;
        pdf.text(line, opts.x || M, y, font, size, color);
      });
      y -= (opts.gapAfter !== undefined ? opts.gapAfter : 4);
    }
    function colorForCall(c){
      const s = String(c||'').toLowerCase();
      if(s==='go') return GOOD;
      if(s==='pass') return RISKC;
      return ACCENT;
    }

    pdf.text('IdeaInspector', M, y, 'timesB', 20, INK);
    pdf.text('SUMMARY', W - M - pdf.textWidth('SUMMARY','cour',9), y+2, 'cour', 9, MUTED);
    y -= 10;
    pdf.lineH(M, y, W-M, y, INK, 1.5);
    y -= 20;
    pdf.text(new Date((record.updatedAt||record.createdAt)).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}), M, y, 'cour', 9, MUTED);
    pdf.text(record.refId, W - M - pdf.textWidth(record.refId,'cour',9), y, 'cour', 9, MUTED);
    y -= 30;

    const cx = M + 34, cy = y - 26, r = 30;
    pdf.circleStroke(cx, cy, r, RULE, 6);
    pdf.circleStroke(cx, cy, r, scoreColor, 5);
    const scoreStr = String(data.overall_score);
    pdf.text(scoreStr, cx - pdf.textWidth(scoreStr,'timesB',20)/2, cy+5, 'timesB', 20, scoreColor);
    pdf.text('OUT OF 100', cx - pdf.textWidth('OUT OF 100','cour',6.5)/2, cy-11, 'cour', 6.5, MUTED);

    const tx = M + 82, tw = CW - 82;
    let ty = y - 6;
    pdf.text(labelForScore(data.overall_score).toUpperCase(), tx, ty, 'cour', 9, scoreColor);
    ty -= 18;
    pdf.wrap(data.title, 'timesB', 15, tw).forEach(l => { pdf.text(l, tx, ty, 'timesB', 15, INK); ty -= 17; });

    y = Math.min(y - 76, ty) - 20;
    pdf.lineH(M, y, W-M, y, RULE, 0.75);
    y -= 22;

    if(data.tldr){
      pdf.rect(M, y-26, CW, 32, INK);
      pdf.text('TL;DR', M+10, y-4, 'cour', 8, [230,225,210]);
      writeBlock(data.tldr, 'timesB', 11, [246,243,236], {x:M+10, width:CW-20, gapAfter:0});
      y -= 16;
    }

    if(data.final_verdict){
      y -= 10;
      pdf.text('FINAL VERDICT', M, y, 'cour', 9, MUTED);
      y -= 20;
      const fc = colorForCall(data.final_verdict.call);
      pdf.text((data.final_verdict.call||'').toUpperCase(), M, y, 'timesB', 16, fc);
      y -= 20;
      writeBlock(data.final_verdict.rationale||'', 'helv', 10, [40,40,38], {gapAfter:0});
    }

    y -= 16;
    pdf.lineH(M, y, W-M, y, RULE, 0.75);
    y -= 16;
    pdf.text('Full memo available via Download PDF in the tool.', M, y, 'cour', 7.5, MUTED);
    y -= 11;
    pdf.text('Automated first-pass diligence - not investment advice.', M, y, 'cour', 7.5, MUTED);

    downloadPdfBlob(pdf.build({title: data.title + ' (Summary)'}), `ideainspector-${safeFilenamePart(data.title)}-summary.pdf`);
  }catch(e){ console.error(e); throw new Error('Could not generate the summary PDF: ' + e.message); }
}
