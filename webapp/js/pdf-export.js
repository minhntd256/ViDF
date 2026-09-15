

const PDF_COLORS = {
  bg: '#f4f4f0', surface: '#ffffff', surface2: '#f0eff9',
  border: '#e2e2dc', border2: '#d0cfc8',
  text: '#1a1a18', text2: '#5a5a54', text3: '#9a9a94',
  verified: '#059669', verifiedBg: '#ecfdf5', verifiedBorder: '#6ee7b7',
  deepfake: '#dc2626', deepfakeBg: '#fff1f2', deepfakeBorder: '#fca5a5',
  primary: '#4338ca',
};

function _pdfHex2rgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}



const _PDF_CLAIM_LINE_RE = /(?=Claim\s*\d+\s*:)/;
const _PDF_CLAIM_LABEL_RE = /^(Claim\s*\d+\s*:)\s*([\s\S]*)$/;
function _pdfReasoningParts(text) {
  const clean = (text || '').trim();
  if (!clean) return [{ label: null, text: '(none)' }];
  const parts = clean.split(_PDF_CLAIM_LINE_RE).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [{ label: null, text: clean }];
  return parts.map(part => {
    const m = part.match(_PDF_CLAIM_LABEL_RE);
    return m ? { label: m[1], text: m[2].trim() } : { label: null, text: part };
  });
}


function _pdfCtx(doc) {
  return {
    doc,
    marginX: 42,
    y: 50,
    pageWidth: doc.internal.pageSize.getWidth() - 84,
    pageHeight: doc.internal.pageSize.getHeight(),
    bottomMargin: 46,
  };
}

function _pdfEnsureRoom(ctx, height) {
  if (ctx.y + height > ctx.pageHeight - ctx.bottomMargin) {
    ctx.doc.addPage();
    ctx.y = 50;
  }
}

function _pdfSetFill(doc, hex) { const [r, g, b] = _pdfHex2rgb(hex); doc.setFillColor(r, g, b); }
function _pdfSetDraw(doc, hex) { const [r, g, b] = _pdfHex2rgb(hex); doc.setDrawColor(r, g, b); }
function _pdfSetText(doc, hex) { const [r, g, b] = _pdfHex2rgb(hex); doc.setTextColor(r, g, b); }


function _pdfParagraph(ctx, text, { x, width, size = 10, color = PDF_COLORS.text2, bold = false, gap = 13 } = {}) {
  const { doc } = ctx;
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  _pdfSetText(doc, color);
  const lines = doc.splitTextToSize(text, width);
  lines.forEach(line => {
    _pdfEnsureRoom(ctx, gap);
    doc.text(line, x, ctx.y);
    ctx.y += gap;
  });
  return lines.length * gap;
}

function _pdfSubhead(ctx, text) {
  _pdfEnsureRoom(ctx, 16);
  ctx.doc.setFont('courier', 'normal');
  ctx.doc.setFontSize(8.5);
  _pdfSetText(ctx.doc, PDF_COLORS.text3);
  ctx.doc.text(text.toUpperCase(), ctx.marginX + 12, ctx.y);
  ctx.y += 13;
}

function _pdfPill(ctx, x, text, { bg, border, color }) {
  const { doc } = ctx;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  const w = doc.getTextWidth(text) + 12;
  const h = 13;
  _pdfSetFill(doc, bg); _pdfSetDraw(doc, border);
  doc.roundedRect(x, ctx.y - 9, w, h, 6, 6, 'FD');
  _pdfSetText(doc, color);
  doc.text(text, x + 6, ctx.y);
  return w;
}

function _pdfHighlightSegments(text, claims, groundingSpans) {
  const clean = (text || '').trim();
  if (!clean) return [{ text: '(empty)', stance: null, nums: [] }];

  const claimSpans = [];
  (claims || []).forEach(c => {
    const span = (typeof findBestMatchSpan === 'function') ? findBestMatchSpan(clean, c.text) : null;
    if (span) claimSpans.push({ ...span, num: c.num, stance: c.stance || 'neutral' });
  });

  if (claimSpans.length) {
    const boundaries = new Set([0, clean.length]);
    claimSpans.forEach(s => { boundaries.add(s.start); boundaries.add(s.end); });
    const cuts = Array.from(boundaries).sort((a, b) => a - b);
    const stancePriority = { refute: 2, support: 1, neutral: 0 };
    const segments = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const segStart = cuts[i], segEnd = cuts[i + 1];
      if (segStart >= segEnd) continue;
      const covering = claimSpans.filter(s => s.start <= segStart && s.end >= segEnd);
      const chunk = clean.slice(segStart, segEnd);
      if (!covering.length) {
        segments.push({ text: chunk, stance: null, nums: [] });
      } else {
        const stance = covering.reduce((acc, s) => (stancePriority[s.stance] > stancePriority[acc] ? s.stance : acc), 'neutral');
        segments.push({ text: chunk, stance, nums: covering.map(s => s.num) });
      }
    }
    return segments;
  }

  
  
  const validSpans = (groundingSpans || []).map(s => (s || '').trim()).filter(Boolean);
  if (!validSpans.length) return [{ text: clean, stance: null, nums: [] }];

  const escapeForRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sorted = [...validSpans].sort((a, b) => b.length - a.length);
  const re = new RegExp('(' + sorted.map(escapeForRegex).join('|') + ')', 'gi');

  const segments = [];
  let lastIndex = 0, m;
  while ((m = re.exec(clean)) !== null) {
    if (m.index > lastIndex) segments.push({ text: clean.slice(lastIndex, m.index), stance: null, nums: [] });
    segments.push({ text: m[0], stance: 'refute', nums: [] });
    lastIndex = re.lastIndex;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (lastIndex < clean.length) segments.push({ text: clean.slice(lastIndex), stance: null, nums: [] });
  return segments;
}

function _pdfSegmentsToRuns(segments) {
  const runs = [];
  segments.forEach(seg => {
    const parts = seg.text.split(/(\s+)/).filter(p => p.length);
    let lastWordIdx = -1;
    parts.forEach((p, i) => { if (!/^\s+$/.test(p)) lastWordIdx = i; });
    parts.forEach((p, i) => {
      runs.push({
        text: p,
        stance: seg.stance,
        nums: (seg.stance && i === lastWordIdx) ? seg.nums : [],
      });
    });
  });
  return runs;
}

function _pdfDrawHighlightedParagraph(ctx, segments, { x, width, size = 9.5, gap = 13 } = {}) {
  const { doc } = ctx;
  const stanceColor = {
    refute: PDF_COLORS.deepfake,
    support: PDF_COLORS.verified,
    neutral: PDF_COLORS.text2,
  };
  doc.setFont('helvetica', 'normal'); doc.setFontSize(size);
  const spaceW = doc.getTextWidth(' ');

  const runs = _pdfSegmentsToRuns(segments);
  let lineRuns = [], lineW = 0;

  const flushLine = () => {
    if (!lineRuns.length) return;
    _pdfEnsureRoom(ctx, gap);
    let rx = x;
    lineRuns.forEach(r => {
      if (/^\s+$/.test(r.text)) { rx += spaceW * r.text.length; return; }
      const color = r.stance ? stanceColor[r.stance] : PDF_COLORS.text2;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size);
      _pdfSetText(doc, color);
      doc.text(r.text, rx, ctx.y);
      const w = doc.getTextWidth(r.text);
      if (r.stance) {
        _pdfSetDraw(doc, color);
        doc.setLineWidth(0.6);
        doc.line(rx, ctx.y + 2, rx + w, ctx.y + 2);
      }
      rx += w;
      if (r.nums && r.nums.length) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(size * 0.65);
        _pdfSetText(doc, color);
        const supText = r.nums.join(',');
        doc.text(supText, rx + 1, ctx.y - 3);
        rx += doc.getTextWidth(supText) + 2;
      }
    });
    ctx.y += gap;
    lineRuns = []; lineW = 0;
  };

  runs.forEach(r => {
    const w = doc.getTextWidth(r.text) + (r.nums && r.nums.length ? 6 : 0);
    if (!/^\s+$/.test(r.text) && lineW + w > width && lineRuns.length) flushLine();
    lineRuns.push(r);
    lineW += w;
  });
  flushLine();
}

async function _pdfCaptureElement(elId, { scale = 2, onclone } = {}) {
  const el = document.getElementById(elId);
  if (!el || typeof html2canvas !== 'function') return null;
  try {
    const canvas = await html2canvas(el, {
      scale,                 
      backgroundColor: null, 
      useCORS: true,
      onclone,                
    });
    
    
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } catch (err) {
    console.warn('html2canvas capture failed, falling back to vector verdict card:', err);
    return null;
  }
}

function _pdfDrawCapturedImage(ctx, img, { maxH = ctx.pageHeight - ctx.bottomMargin - 60 } = {}) {
  const { doc } = ctx;
  const maxW = ctx.pageWidth;
  let w = img.width, h = img.height;
  const scale = Math.min(maxW / w, maxH / h, 1); 
  w *= scale; h *= scale;
  const x = ctx.marginX + (ctx.pageWidth - w) / 2;

  _pdfEnsureRoom(ctx, h + 14);
  doc.addImage(img.dataUrl, 'PNG', x, ctx.y, w, h);
  ctx.y += h + 14;
}

async function _pdfDrawVerdictImage(ctx, data) {
  _pdfEnsureRoom(ctx, 20);
  ctx.doc.setFont('courier', 'normal'); ctx.doc.setFontSize(9);
  _pdfSetText(ctx.doc, PDF_COLORS.text3);
  ctx.doc.text('FINAL VERDICT', ctx.marginX, ctx.y);
  ctx.y += 16;

  const img = await _pdfCaptureElement('verdictSection', {
    scale: 3, 
    onclone: (clonedDoc) => {
      const section = clonedDoc.getElementById('verdictSection');
      if (!section) return;
      
      
      
      
      const label = section.querySelector('.section-label');
      if (label) label.style.display = 'none';
      section.style.borderBottom = 'none';
    },
  });
  if (img) {
    _pdfDrawCapturedImage(ctx, img);
  } else {
    
    _pdfDrawVerdictVector(ctx, data);
  }
}

function _pdfDrawVerdictVector(ctx, data) {
  const { doc } = ctx;
  const isReal = data.verdict === 'REAL';
  const c = isReal
    ? { bg: PDF_COLORS.verifiedBg, border: PDF_COLORS.verifiedBorder, fg: PDF_COLORS.verified }
    : { bg: PDF_COLORS.deepfakeBg, border: PDF_COLORS.deepfakeBorder, fg: PDF_COLORS.deepfake };

  const cardH = 108;
  _pdfEnsureRoom(ctx, cardH + 14);
  const cardW = ctx.pageWidth;
  const cardX = ctx.marginX;
  const cardY = ctx.y;
  _pdfSetFill(doc, c.bg); _pdfSetDraw(doc, c.border);
  doc.roundedRect(cardX, cardY, cardW, cardH, 8, 8, 'FD');

  
  
  
  
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  _pdfSetText(doc, c.fg);
  doc.text(data.verdict || '', cardX + cardW / 2, cardY + 38, { align: 'center' });

  
  const pct = (data.conf && data.conf.overall) || 0;
  const barW = 220, barH = 8;
  const barX = cardX + (cardW - barW) / 2, barY = cardY + 68;
  _pdfSetFill(doc, PDF_COLORS.surface); _pdfSetDraw(doc, c.border);
  doc.roundedRect(barX, barY, barW, barH, 4, 4, 'FD');
  _pdfSetFill(doc, c.fg);
  doc.roundedRect(barX, barY, Math.max(barH, (barW * pct) / 100), barH, 4, 4, 'F');

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  _pdfSetText(doc, c.fg);
  doc.text(`${pct}% confidence`, cardX + cardW / 2, barY + 22, { align: 'center' });

  ctx.y = cardY + cardH + 14;

  
  if (!isReal && data.fake_type_labels && data.fake_type_labels.length) {
    let x = ctx.marginX;
    const rowY = ctx.y;
    _pdfEnsureRoom(ctx, 20);
    data.fake_type_labels.forEach(l => {
      const w = _pdfPill(ctx, x, l, { bg: PDF_COLORS.deepfakeBg, border: PDF_COLORS.deepfakeBorder, color: PDF_COLORS.deepfake });
      x += w + 6;
    });
    ctx.y = rowY + 20;
  }
  ctx.y += 6;
}

function _pdfDrawClaim(ctx, claim, evidenceIndex) {
  const { doc } = ctx;
  const stanceColors = {
    support: { bg: PDF_COLORS.verifiedBg, border: PDF_COLORS.verifiedBorder, bar: PDF_COLORS.verified },
    refute: { bg: PDF_COLORS.deepfakeBg, border: PDF_COLORS.deepfakeBorder, bar: PDF_COLORS.deepfake },
    neutral: { bg: PDF_COLORS.surface2, border: PDF_COLORS.border2, bar: PDF_COLORS.border2 },
  };
  const sc = stanceColors[claim.stance] || stanceColors.neutral;
  const evidence = evidenceIndex ? (evidenceIndex.get(_normText(claim.text)) || []) : [];

  const innerX = ctx.marginX + 34;
  const textWidth = ctx.pageWidth - 34 - 10;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  const claimLines = doc.splitTextToSize(claim.text, textWidth);

  const cardPad = 8;
  const cardTextWidth = textWidth - cardPad * 2;

  
  
  
  const _evCardHeight = e => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    const titleLines = doc.splitTextToSize(e.title || '(untitled)', cardTextWidth).length;
    return cardPad * 2 + titleLines * 11 + 10;
  };

  
  
  const evHeight = evidence.length
    ? evidence.reduce((n, e) => n + _evCardHeight(e) + 6, 0)
    : 11;

  const blockH = 12 + claimLines.length * 13 + 12 + evHeight + 10;
  _pdfEnsureRoom(ctx, blockH + 8);
  const blockY = ctx.y;

  _pdfSetFill(doc, sc.bg); _pdfSetDraw(doc, sc.border);
  doc.roundedRect(ctx.marginX, blockY, ctx.pageWidth, blockH, 6, 6, 'FD');
  
  _pdfSetFill(doc, sc.bar);
  doc.rect(ctx.marginX, blockY, 3, blockH, 'F');

  
  const badgeCx = ctx.marginX + 20, badgeCy = blockY + 17;
  _pdfSetFill(doc, PDF_COLORS.bg); _pdfSetDraw(doc, PDF_COLORS.border2);
  doc.circle(badgeCx, badgeCy, 8, 'FD');
  doc.setFont('courier', 'bold'); doc.setFontSize(8);
  _pdfSetText(doc, PDF_COLORS.text2);
  doc.text(String(claim.num != null ? claim.num : '?'), badgeCx, badgeCy + 2.8, { align: 'center' });

  let ly = blockY + 15;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  _pdfSetText(doc, PDF_COLORS.text);
  claimLines.forEach(line => { doc.text(line, innerX, ly); ly += 13; });

  ly += 3;
  doc.setFont('courier', 'normal'); doc.setFontSize(7.5);
  _pdfSetText(doc, PDF_COLORS.text3);
  doc.text('EVIDENCE', innerX, ly);
  ly += 10;

  if (!evidence.length) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5);
    _pdfSetText(doc, PDF_COLORS.text3);
    doc.text('No evidence found.', innerX, ly);
    ly += 11;
  } else {
    evidence.forEach(e => {
      const cardH = _evCardHeight(e);
      
      
      
      _pdfSetFill(doc, PDF_COLORS.surface2); _pdfSetDraw(doc, PDF_COLORS.border2);
      doc.roundedRect(innerX, ly, textWidth, cardH, 3, 3, 'FD');

      let cy = ly + cardPad + 8;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      _pdfSetText(doc, PDF_COLORS.primary);
      const titleLines = doc.splitTextToSize(e.title || '(untitled)', cardTextWidth);
      titleLines.forEach(line => {
        if (e.url) doc.textWithLink(line, innerX + cardPad, cy, { url: e.url });
        else doc.text(line, innerX + cardPad, cy);
        cy += 11;
      });

      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      _pdfSetText(doc, PDF_COLORS.text3);
      doc.text(e.source || '', innerX + cardPad, cy);

      ly += cardH + 6;
    });
  }

  ctx.y = blockY + blockH + 8;
}


function _pdfDrawSegments(ctx, ranges) {
  if (!ranges || !ranges.length) return;
  const { doc } = ctx;
  _pdfEnsureRoom(ctx, 16);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  _pdfSetText(doc, PDF_COLORS.deepfake);
  doc.text('Suspicious segment(s):', ctx.marginX + 12, ctx.y);
  let x = ctx.marginX + 12 + doc.getTextWidth('Suspicious segment(s):') + 8;
  ranges.forEach(r => {
    const label = _fmtSecRange(r);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const w = doc.getTextWidth(label) + 10;
    if (x + w > ctx.marginX + ctx.pageWidth) { ctx.y += 16; x = ctx.marginX + 12; }
    _pdfSetDraw(doc, PDF_COLORS.deepfakeBorder);
    doc.roundedRect(x, ctx.y - 8, w, 12, 5, 5, 'S');
    _pdfSetText(doc, PDF_COLORS.deepfake);
    doc.text(label, x + 5, ctx.y);
    x += w + 5;
  });
  ctx.y += 16;
}

function _pdfDrawDomain(ctx, d, opts) {
  const { doc } = ctx;
  const isTitle = /^title$/i.test(d.domain || '');
  const isSpeech = /^speech$/i.test(d.domain || '');
  const isTemporal = /^temporal$/i.test(d.domain || '');
  const isCgi = /^cgi$/i.test(d.domain || '');

  _pdfEnsureRoom(ctx, 22);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5);
  _pdfSetText(doc, PDF_COLORS.text);
  doc.text(d.domain || '', ctx.marginX, ctx.y);
  const isCrossModal = /^cross.?modal$/i.test(d.domain || '');

  
  
  const notProvided = (isTitle || isCrossModal) && !opts.caption.trim();

  const nameW = doc.getTextWidth(d.domain || '');
  let bx = ctx.marginX + nameW + 10;
  if (notProvided) {
    _pdfPill(ctx, bx, 'N/A', { bg: PDF_COLORS.surface2, border: PDF_COLORS.border2, color: PDF_COLORS.text3 });
  } else {
    const badges = (d.labels && d.labels.length) ? d.labels : ['Real'];
    const isReal = !(d.labels && d.labels.length);
    badges.forEach(l => {
      const w = _pdfPill(ctx, bx, l, isReal
        ? { bg: PDF_COLORS.verifiedBg, border: PDF_COLORS.verifiedBorder, color: PDF_COLORS.verified }
        : { bg: PDF_COLORS.deepfakeBg, border: PDF_COLORS.deepfakeBorder, color: PDF_COLORS.deepfake });
      bx += w + 5;
    });
  }
  ctx.y += 18;

  if (isTitle && !opts.caption.trim()) {
    _pdfParagraph(ctx, 'No title provided.', { x: ctx.marginX + 12, width: ctx.pageWidth - 12, size: 9, color: PDF_COLORS.text3 });
  } else if (isTitle || isSpeech) {
    const origin = isTitle ? 'title' : 'speech';
    const claims = (opts.numberedClaims || []).filter(c => c._origin === origin);
    const fullText = isTitle ? opts.caption : opts.transcriptText;

    const groundingSpans = isTitle ? opts.titleGroundingSpans : opts.speechGroundingSpans;
    const segments = _pdfHighlightSegments(fullText, claims, groundingSpans);
    _pdfSubhead(ctx, isTitle ? 'Full Title' : 'Full Transcript');
    _pdfDrawHighlightedParagraph(ctx, segments, { x: ctx.marginX + 12, width: ctx.pageWidth - 12, size: 9.5, gap: 12.5 });
    ctx.y += 4;

    _pdfSubhead(ctx, 'Claims');
    if (!claims.length) {
      _pdfParagraph(ctx, 'No claims extracted.', { x: ctx.marginX + 12, width: ctx.pageWidth - 12, size: 9, color: PDF_COLORS.text3 });
    } else {
      claims.forEach(c => _pdfDrawClaim(ctx, c, opts.evidenceIndex));
    }
    ctx.y += 2;

    _pdfSubhead(ctx, 'Reasoning');
    _pdfReasoningParts(d.reasoning).forEach(p => {
      if (p.label) {
        _pdfEnsureRoom(ctx, 13);
        ctx.doc.setFont('helvetica', 'bold'); ctx.doc.setFontSize(9.5);
        _pdfSetText(ctx.doc, PDF_COLORS.text2);
        ctx.doc.text(p.label, ctx.marginX + 12, ctx.y);
        const lw = ctx.doc.getTextWidth(p.label + ' ');
        _pdfParagraphInline(ctx, p.text, ctx.marginX + 12 + lw, ctx.pageWidth - 12 - lw);
      } else {
        _pdfParagraph(ctx, p.text, { x: ctx.marginX + 12, width: ctx.pageWidth - 12, size: 9.5, color: PDF_COLORS.text2 });
      }
    });
  } else {
    if (isTemporal) _pdfDrawSegments(ctx, opts.temporalRanges);
    else if (isCgi) _pdfDrawSegments(ctx, opts.cgiRanges);
    _pdfReasoningParts(d.reasoning).forEach(p => {
      _pdfParagraph(ctx, p.label ? `${p.label} ${p.text}` : p.text, { x: ctx.marginX + 12, width: ctx.pageWidth - 12, size: 9.5, color: PDF_COLORS.text2 });
    });
  }
  ctx.y += 14;
}

function _pdfParagraphInline(ctx, text, x, width) {
  const { doc } = ctx;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  _pdfSetText(doc, PDF_COLORS.text2);
  const lines = doc.splitTextToSize(text, width);
  lines.forEach((line, i) => {
    if (i > 0) _pdfEnsureRoom(ctx, 13);
    doc.text(line, i === 0 ? x : ctx.marginX + 12, ctx.y);
    ctx.y += 13;
  });
}

async function _pdfGetVideoThumbnail() {
  if (currentVideoThumbnail) return currentVideoThumbnail;
  const sourceVideo = document.getElementById('videoPlayer');
  if (!sourceVideo || !sourceVideo.src) return null;
  return _findNonBlackFrame(sourceVideo);
}

function _pdfDrawVideoSection(ctx, thumbnail) {
  const { doc } = ctx;
  if (!thumbnail) return;

  _pdfEnsureRoom(ctx, 20);
  doc.setFont('courier', 'normal'); doc.setFontSize(9);
  _pdfSetText(doc, PDF_COLORS.text3);
  doc.text('VIDEO', ctx.marginX, ctx.y);
  ctx.y += 16;

  const maxW = ctx.pageWidth;
  const maxH = 220;
  let w = thumbnail.width, h = thumbnail.height;
  const scale = Math.min(maxW / w, maxH / h, 1);
  w *= scale; h *= scale;
  const x = ctx.marginX + (ctx.pageWidth - w) / 2;

  _pdfEnsureRoom(ctx, h + 14);
  _pdfSetDraw(doc, PDF_COLORS.border);
  doc.roundedRect(x - 2, ctx.y - 2, w + 4, h + 4, 4, 4, 'S');
  doc.addImage(thumbnail.dataUrl, 'JPEG', x, ctx.y, w, h);
  ctx.y += h + 18;
}

async function exportReasoningPdf() {
  const data = window.__lastReasoningData;
  if (!data) return;
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert('PDF export library failed to load. Check your connection and try again.');
    return;
  }

  const btn = document.getElementById('reasoningExportBtn');
  const btnOrigHtml = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  let thumbnail = null;
  try {
    thumbnail = await _pdfGetVideoThumbnail();
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = btnOrigHtml; }
  }

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const ctx = _pdfCtx(doc);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
  _pdfSetText(doc, PDF_COLORS.text);
  doc.text('ViDF — Report', doc.internal.pageSize.getWidth() / 2, ctx.y, { align: 'center' });
  ctx.y += 26;

  _pdfDrawVideoSection(ctx, thumbnail);

  await _pdfDrawVerdictImage(ctx, data);

  _pdfEnsureRoom(ctx, 20);
  doc.setFont('courier', 'normal'); doc.setFontSize(9);
  _pdfSetText(doc, PDF_COLORS.text3);
  doc.text('REASONING SUMMARY', ctx.marginX, ctx.y);
  ctx.y += 18;

  const opts = {
    caption: (document.getElementById('captionBox') || {}).value || '',
    transcriptText: (currentTranscriptSegments || []).map(s => s.text).join(' '),
    numberedClaims: currentNumberedClaims || [],
    evidenceIndex: (currentEvidence && currentTavilyEnabled) ? _buildEvidenceIndex(currentEvidence) : null,
    temporalRanges: _temporalFlaggedRanges(((currentDomainResults || {}).temporal || {}).temporal_grounding),
    cgiRanges: _cgiFlaggedRanges(((currentDomainResults || {}).cgi || {}).cgi_grounding),
    titleGroundingSpans: (((currentDomainResults || {}).title || {}).text_groundings || {}).false_title || [],
    speechGroundingSpans: (((currentDomainResults || {}).speech || {}).text_groundings || {}).false_speech || [],
  };

  const domains = data.domain_summaries || [];
  if (!domains.length) {
    _pdfParagraph(ctx, _htmlToPlainText(data.reasoning) || '(no reasoning returned)', { x: ctx.marginX, width: ctx.pageWidth, size: 10 });
  } else {
    domains.forEach(d => _pdfDrawDomain(ctx, d, opts));
  }


  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    _pdfSetText(doc, PDF_COLORS.text3);
    doc.text(`${i} / ${pageCount}`, doc.internal.pageSize.getWidth() - 42, doc.internal.pageSize.getHeight() - 22, { align: 'right' });
  }

  doc.save('vidf-report.pdf');
}
