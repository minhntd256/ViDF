

const DETAIL_MODAL_TITLES = {
  title: 'Title Analysis — Detail',
  speech: 'Speech Analysis — Detail',
  temporal: 'Temporal Analysis — Detail',
  cgi: 'CGI Analysis — Detail',
  crossModal: 'Cross-modal Analysis — Detail',
  speechVideo: 'Speech vs. Video — Detail',
  reasoningSummary: 'Reasoning Summary — Detail',
};

const DETAIL_RENDERERS = {
  title: renderTitleDetail,
  speech: renderSpeechDetail,
  temporal: renderTemporalDetail,
  cgi: renderCgiDetail,
  crossModal: renderCrossModalDetail,
  speechVideo: renderSpeechVideoDetail,
  reasoningSummary: renderReasoningSummaryDetail,
};

function openDetailModal(key) {
  
  
  const res = key === 'reasoningSummary' ? window.__lastReasoningData : currentDomainResults[key];
  const overlay = document.getElementById('detailModalOverlay');
  document.getElementById('detailModalTitle').textContent = DETAIL_MODAL_TITLES[key] || 'Detail';

  const body = document.getElementById('detailModalBody');
  body.innerHTML = res
    ? (DETAIL_RENDERERS[key] ? DETAIL_RENDERERS[key](res) : '<p>No renderer for this section.</p>')
    : '<p style="color:var(--text3)">No data yet — run analysis first.</p>';

  overlay.classList.add('open');
  document.addEventListener('keydown', _onDetailModalKeydown);

  if (!res) return;

  
  
  
  if (key === 'temporal' || key === 'cgi') {
    
    
    
    _detailKey = key;
    _detailRes = res;
    
    
    _detailDuration = currentVideoDuration || videoDuration || 0;
    _attachPopupVideo();
    _loadDetailFilmstrip(key, res, _detailDuration);
  } else if (key === 'crossModal') {
    const mainPlayer = document.getElementById('videoPlayer');
    const popupVideo = document.getElementById('crossModalDetailVideo');
    if (popupVideo && mainPlayer && mainPlayer.src) {
      popupVideo.src = mainPlayer.src;
      if (currentVideoThumbnail) popupVideo.poster = currentVideoThumbnail.dataUrl;
    }
  } else if (key === 'speechVideo') {
    const mainPlayer = document.getElementById('videoPlayer');
    const popupVideo = document.getElementById('speechVideoDetailVideo');
    if (popupVideo && mainPlayer && mainPlayer.src) {
      popupVideo.src = mainPlayer.src;
      if (currentVideoThumbnail) popupVideo.poster = currentVideoThumbnail.dataUrl;
    }
  }
}

let _detailKey = null;
let _detailRes = null;
let _detailDuration = 0;

let _detailFrames = [];
let _detailActiveFrameIdx = -1;

function closeDetailModal() {
  
  
  
  
  
  const popupVideo = document.getElementById('detailPopupVideo');
  if (popupVideo) {
    popupVideo.pause();
    popupVideo.removeAttribute('src');
    popupVideo.load();
  }
  const crossModalVideo = document.getElementById('crossModalDetailVideo');
  if (crossModalVideo) {
    crossModalVideo.pause();
    crossModalVideo.removeAttribute('src');
    crossModalVideo.load();
  }
  const speechVideoVideo = document.getElementById('speechVideoDetailVideo');
  if (speechVideoVideo) {
    speechVideoVideo.pause();
    speechVideoVideo.removeAttribute('src');
    speechVideoVideo.load();
  }
  document.getElementById('detailModalOverlay').classList.remove('open');
  document.removeEventListener('keydown', _onDetailModalKeydown);
}

function _onDetailModalKeydown(e) {
  if (e.key === 'Escape') closeDetailModal();
}

function _fakeTypesHtml(fakeTypes) {
  if (!fakeTypes || !fakeTypes.length) {
    return '<span class="verdict-tag tag-real">REAL</span>';
  }
  return fakeTypes.map(t => `<span class="verdict-tag tag-fake">${escapeHtml(labelForFakeType(t))}</span>`).join(' ');
}

function _loadDetailFilmstrip(key, res, duration) {
  const ranges = key === 'temporal'
    ? _temporalFlaggedRanges(res.temporal_grounding || {})
    : _cgiFlaggedRanges(res.cgi_grounding || {});

  const renderInto = (frames) => {
    const wrap = document.getElementById('detailFilmstripWrap');
    if (!wrap) return; 
    _detailFrames = frames;
    _detailActiveFrameIdx = -1;
    wrap.innerHTML = _buildFilmstripBlock(frames, ranges, duration);
    _syncDetailPlayhead();
  };

  const cached = detailDenseFramesCache[key];
  if (cached) { renderInto(cached); return; }

  extractDenseFrames(duration, currentVideoFps).then(frames => {
    detailDenseFramesCache[key] = frames;
    renderInto(frames);
  });
}

const FS_MIN_FRAME_WIDTH = 24;

function _buildFilmstripBlock(frames, flaggedRanges, duration) {
  const dur = duration > 0 ? duration : (frames.length ? parseTime(frames[frames.length - 1].t) : 0) || 1;
  const ranges = flaggedRanges || [];
  const tickStep = 2;
  const tickTimes = [];
  for (let t = 0; t <= dur; t += tickStep) tickTimes.push(t);
  const lastTick = tickTimes[tickTimes.length - 1];
  if (lastTick === undefined) {
    tickTimes.push(dur);
  } else if (dur - lastTick > tickStep / 2) {
    tickTimes.push(dur);
  } else {
    tickTimes[tickTimes.length - 1] = dur;
  }
  const ticksHtml = tickTimes.map((t, i) => {
    const isLast = i === tickTimes.length - 1;
    const style = isLast ? 'right:0' : `left:${((t / dur) * 100).toFixed(2)}%`;
    const cls = isLast ? 'tick tick-end' : 'tick';
    return `<div class="${cls}" style="${style}"><span>${fmtTime(t)}</span></div>`;
  }).join('');

  const flagBarHtml = ranges.map(([s, e]) => {
    const left = Math.max(0, (s / dur) * 100);
    const width = Math.max(0.6, ((e - s) / dur) * 100);
    return `<div class="tl-flag" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></div>`;
  }).join('');

  const flagRegionHtml = ranges.map(([s, e]) => {
    const left = Math.max(0, (s / dur) * 100);
    const width = Math.max(0.6, ((e - s) / dur) * 100);
    return `<div class="filmstrip-flag-region" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></div>`;
  }).join('');


  
  
  
  const framesHtml = frames.length
    ? frames.map((f, idx) => `<div class="fs-frame" data-idx="${idx}" style="background-image:url('${f.src || ''}')" title="${f.t}" onclick="_seekDetailVideos(${f.raw != null ? f.raw : parseTime(f.t)})"></div>`).join('')
    : '<div class="fs-frame fs-frame-empty">No frames extracted</div>';

  return `
    <div class="filmstrip-scroll">
      <div class="filmstrip-content">
        <div class="timeline-bar" onclick="_seekTimelineClick(event, ${dur})">
          ${flagBarHtml}
          <div class="tl-playhead" id="detailTlPlayhead" style="left:0%"></div>
        </div>
        <div class="filmstrip-ruler">${ticksHtml}</div>
        <div class="filmstrip-track">
          ${framesHtml}
          ${flagRegionHtml}
          <div class="filmstrip-playhead" id="detailFsPlayhead" style="left:0%"></div>
        </div>
      </div>
    </div>
  `;
}


function _seekTimelineClick(evt, duration) {
  const rect = evt.currentTarget.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (evt.clientX - rect.left) / rect.width));
  _seekDetailVideos(ratio * duration);
}



function _seekDetailVideos(seconds) {
  const popupVideo = document.getElementById('detailPopupVideo');
  const duration = _detailDuration;
  const target = duration > 0 ? Math.min(seconds, duration) : Math.max(0, seconds);

  if (popupVideo && popupVideo.src) {
    if (popupVideo.readyState >= 1) {
      popupVideo.currentTime = target;
    } else {
      popupVideo.addEventListener('loadedmetadata', () => {
        popupVideo.currentTime = target;
      }, { once: true });
    }
  }

  
  
  
  _setDetailPlayheadPct(duration > 0 ? (target / duration) * 100 : 0);
  _setActiveFrame(target);
}

function _setActiveFrame(seconds) {
  if (!_detailFrames.length) return;
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < _detailFrames.length; i++) {
    const raw = _detailFrames[i].raw != null ? _detailFrames[i].raw : parseTime(_detailFrames[i].t);
    const diff = Math.abs(raw - seconds);
    if (diff < best) { best = diff; idx = i; }
  }
  if (idx === _detailActiveFrameIdx) return;
  const track = document.getElementById('detailFilmstripWrap');
  if (!track) return;
  if (_detailActiveFrameIdx >= 0) {
    const prev = track.querySelector(`.fs-frame[data-idx="${_detailActiveFrameIdx}"]`);
    if (prev) prev.classList.remove('fs-frame-active');
  }
  const next = track.querySelector(`.fs-frame[data-idx="${idx}"]`);
  if (next) next.classList.add('fs-frame-active');
  _detailActiveFrameIdx = idx;
}

function _syncDetailPlayhead() {
  const video = document.getElementById('detailPopupVideo');
  if (!video || !_detailDuration) return;
  const pct = Math.min(100, Math.max(0, (video.currentTime / _detailDuration) * 100));
  _setDetailPlayheadPct(pct);
  _setActiveFrame(video.currentTime);
}

function _setDetailPlayheadPct(pct) {
  const tlPh = document.getElementById('detailTlPlayhead');
  const fsPh = document.getElementById('detailFsPlayhead');
  if (!tlPh || !fsPh) return;
  const clamped = Math.min(100, Math.max(0, pct));
  tlPh.style.left = clamped + '%';
  fsPh.style.left = clamped + '%';
}

function _attachPopupVideo() {
  const mainPlayer = document.getElementById('videoPlayer');
  const popupVideo = document.getElementById('detailPopupVideo');
  if (!popupVideo || !mainPlayer || !mainPlayer.src) return;
  popupVideo.src = mainPlayer.src;
  if (currentVideoThumbnail) popupVideo.poster = currentVideoThumbnail.dataUrl;
  popupVideo.addEventListener('timeupdate', _syncDetailPlayhead);
  popupVideo.addEventListener('seeked', _syncDetailPlayhead);

  
  
  
  
  
  
  
  popupVideo.addEventListener('loadedmetadata', () => {
    const real = popupVideo.duration;
    if (Number.isFinite(real) && real > 0 && Math.abs(real - _detailDuration) > 0.3) {
      _detailDuration = real;
      if (_detailKey && _detailRes) _loadDetailFilmstrip(_detailKey, _detailRes, _detailDuration);
    }
  }, { once: true });
}

function _temporalFlaggedRanges(temporalGrounding) {
  if (!temporalGrounding || !temporalGrounding.transition_frames || !currentVideoFps) return [];
  return temporalGrounding.transition_frames.map(fr => {
    const t = fr / currentVideoFps;
    return [Math.max(0, t - 1), t + 1];
  });
}

function _cgiFlaggedRanges(cgiGrounding) {
  if (!cgiGrounding || !cgiGrounding.frame_span || !currentVideoFps) return [];
  const [fs, fe] = cgiGrounding.frame_span;
  return fe > fs ? [[fs / currentVideoFps, fe / currentVideoFps]] : [];
}

function _fmtSecRange([start, end]) {
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

function suspiciousSegmentsHtml(ranges) {
  if (!ranges || !ranges.length) return '';
  return `
    <div class="reasoning-segment-row">
      <span class="reasoning-segment-flag">Suspicious segment(s):</span>
      ${ranges.map(r => `<span class="reasoning-segment-chip">${_fmtSecRange(r)}</span>`).join('')}
    </div>`;
}

function buildReasoningDomainsHtml(data) {
  const caption = (document.getElementById('captionBox') || {}).value || '';
  const domainResults = currentDomainResults || {};
  return ((data.domain_summaries) || []).map(d => {
    const isTitle = /^title$/i.test(d.domain || '');
    const isSpeech = /^speech$/i.test(d.domain || '');
    const isTemporal = /^temporal$/i.test(d.domain || '');
    const isCgi = /^cgi$/i.test(d.domain || '');

    let body;
    if (isTitle && !caption.trim()) {
      body = `<p style="color:var(--text3)">No title provided.</p>`;
    } else if (isTitle || isSpeech) {
      const origin = isTitle ? 'title' : 'speech';
      const claims = (currentNumberedClaims || []).filter(c => c._origin === origin);

      
      
      
      
      
      
      const targetElId = isTitle ? 'reasoningSummaryTitleText' : 'reasoningSummarySpeechText';
      const fullText = isTitle ? caption : (currentTranscriptSegments || []).map(s => s.text).join(' ');
      const spans = (domainResults[origin] && domainResults[origin].text_groundings
        && domainResults[origin].text_groundings[isTitle ? 'false_title' : 'false_speech']) || [];
      const highlighted = highlightClaims(fullText, claims) ?? highlightSpans(fullText, spans);

      const claimsHtml = claimUnitsHtml(claims, { emptyMessage: 'No claims extracted.', colorMode: 'stance', targetElId, evidence: currentEvidence, compactEmpty: true });

      body = `
        <div class="reasoning-subhead">${isTitle ? 'Full Title' : 'Full Transcript'}</div>
        <p id="${targetElId}">${highlighted}</p>
        <div class="reasoning-subhead" style="margin-top:10px">Claims</div>
        ${claimsHtml}
        <div class="reasoning-subhead" style="margin-top:10px">Reasoning</div>
        ${formatClaimReasoningHtml(d.reasoning || '')}`;
    } else {
      let segmentHtml = '';
      if (isTemporal) {
        const ranges = _temporalFlaggedRanges((domainResults.temporal || {}).temporal_grounding);
        segmentHtml = suspiciousSegmentsHtml(ranges);
      } else if (isCgi) {
        const ranges = _cgiFlaggedRanges((domainResults.cgi || {}).cgi_grounding);
        segmentHtml = suspiciousSegmentsHtml(ranges);
      }
      body = segmentHtml + formatClaimReasoningHtml(d.reasoning || '');
    }

    const isCrossModal = /^cross.?modal$/i.test(d.domain || '');
  
    
    
    const notProvided = (isTitle || isCrossModal) && !caption.trim();

    const badges = notProvided
      ? `<span class="reasoning-badge reasoning-badge-neutral">N/A</span>`
      : (d.labels && d.labels.length)
        ? d.labels.map(l => `<span class="reasoning-badge reasoning-badge-danger">${l}</span>`).join('')
        : `<span class="reasoning-badge reasoning-badge-success">Real</span>`;
    return `
      <div class="reasoning-domain" style="margin-bottom:14px">
        <div class="reasoning-domain-head"><span class="reasoning-domain-name">${d.domain}</span>${badges}</div>
        <div class="reasoning-domain-body">${body}</div>
      </div>`;
  }).join('');
}

function renderReasoningSummaryDetail(data) {
  const verdictColors = {
    REAL: { bg: 'var(--verified-bg)', border: 'var(--verified-border)', color: 'var(--verified)' },
    FAKE: { bg: 'var(--deepfake-bg)', border: 'var(--deepfake-border)', color: 'var(--deepfake)' },
  };
  const vc = verdictColors[data.verdict] || verdictColors.FAKE;
  const pct = (data.conf && data.conf.overall) || 0;
  const dash = (113 - (113 * pct) / 100).toFixed(1);

  const verdictCardHtml = `
    <div class="verdict-card" style="background:${vc.bg};border-color:${vc.border};color:${vc.color}">
      <div class="verdict-icon">${data.icon || ''}</div>
      <div class="verdict-label" style="color:${vc.color}">${data.verdict}</div>
      <div class="verdict-gauge">
        <svg width="88" height="52" viewBox="0 0 88 52">
          <path d="M 8 48 A 36 36 0 0 1 80 48" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" opacity="0.35"></path>
          <path d="M 8 48 A 36 36 0 0 1 80 48" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"
                stroke-dasharray="113" stroke-dashoffset="${dash}"></path>
          <text x="44" y="46" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">${pct}%</text>
        </svg>
        <div class="verdict-gauge-caption">Confidence score</div>
      </div>
    </div>`;

  const domainsHtml = buildReasoningDomainsHtml(data);

  return `
    ${verdictCardHtml}
    <div style="margin-top:14px">${domainsHtml || '<p style="color:var(--text3)">No domain breakdown available.</p>'}</div>
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);text-align:right">
      <button class="export-pdf-btn" onclick="exportReasoningPdf()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
        Export PDF
      </button>
    </div>
  `;
}


function renderTitleDetail(res) {
  const caption = document.getElementById('captionBox').value || '';
  const spans = (res.text_groundings && res.text_groundings.false_title) || [];
  const titleClaims = (currentNumberedClaims || []).filter(c => c._origin === 'title');
  const highlighted = highlightClaims(caption, titleClaims) ?? highlightSpans(caption, spans);
  return `
    <h4>Result</h4>
    <p>${_fakeTypesHtml(res.fake_types)}</p>
    <h4>Full Title</h4>
    <p id="detailTitleText">${highlighted}</p>
    <h4>Claims</h4>
    <div>${claimUnitsHtml(titleClaims, { emptyMessage: 'No title claims extracted.', colorMode: 'stance', targetElId: 'detailTitleText', evidence: currentEvidence })}</div>
    <h4>Reasoning</h4>
    ${formatClaimReasoningHtml(res.reasoning)}
  `;
}

function renderSpeechDetail(res) {
  const text = (currentTranscriptSegments || []).map(s => s.text).join(' ');
  const spans = (res.text_groundings && res.text_groundings.false_speech) || [];
  const speechClaims = (currentNumberedClaims || []).filter(c => c._origin === 'speech');
  const highlighted = highlightClaims(text, speechClaims) ?? highlightSpans(text, spans);
  return `
    <h4>Result</h4>
    <p>${_fakeTypesHtml(res.fake_types)}</p>
    <h4>Full Transcript</h4>
    <p id="detailSpeechText">${highlighted}</p>
    <h4>Claims</h4>
    <div>${claimUnitsHtml(speechClaims, { emptyMessage: 'No speech claims extracted.', colorMode: 'stance', targetElId: 'detailSpeechText', evidence: currentEvidence })}</div>
    <h4>Reasoning</h4>
    ${formatClaimReasoningHtml(res.reasoning)}
  `;
}

function renderTemporalDetail(res) {
  const tg = res.temporal_grounding || {};
  return `
    <h4>Result</h4>
    <p>${_fakeTypesHtml(res.fake_types)}</p>
    <h4>Video</h4>
    <video class="popup-video" id="detailPopupVideo" controls></video>
    <h4>Timeline &amp; Frames</h4>
    <div id="detailFilmstripWrap"><div class="filmstrip-loading">Extracting frames…</div></div>
    <h4>Reasoning</h4>
    <p>${escapeHtml(tg.reasoning || res.reasoning || '(none)')}</p>
  `;
}

function renderCgiDetail(res) {
  const cg = res.cgi_grounding || {};
  return `
    <h4>Result</h4>
    <p>${_fakeTypesHtml(res.fake_types)}</p>
    <h4>Object Description</h4>
    <p>${escapeHtml(cg.object_description || '(none)')}</p>
    <h4>Video</h4>
    <video class="popup-video" id="detailPopupVideo" controls></video>
    <h4>Timeline &amp; Frames</h4>
    <div id="detailFilmstripWrap"><div class="filmstrip-loading">Extracting frames…</div></div>
    <h4>Reasoning</h4>
    <p>${escapeHtml(res.reasoning || '(none)')}</p>
  `;
}

function renderCrossModalDetail(res) {
  const caption = document.getElementById('captionBox').value || '';
  return `
    <h4>Video</h4>
    <video class="popup-video" id="crossModalDetailVideo" controls></video>
    <h4>Title</h4>
    <p>${caption ? escapeHtml(caption) : '<span style="color:var(--text3)">(no title provided)</span>'}</p>
    <h4>Result</h4>
    <p>${_fakeTypesHtml(res.fake_types)}</p>
    <h4>Full Analysis</h4>
    <p>${escapeHtml(res.analysis_text || '(none)')}</p>
    <h4>Reasoning</h4>
    <p>${escapeHtml(res.reasoning || '(none)')}</p>
  `;
}

function renderSpeechVideoDetail(res) {
  const transcriptText = (currentTranscriptSegments && currentTranscriptSegments.length)
    ? currentTranscriptSegments.map(s => s.text).join(' ')
    : '';
  return `
    <h4>Video</h4>
    <video class="popup-video" id="speechVideoDetailVideo" controls></video>
    <h4>Transcript</h4>
    <p>${transcriptText ? escapeHtml(transcriptText) : '<span style="color:var(--text3)">(no transcript available)</span>'}</p>
    <h4>Result</h4>
    <p>${_fakeTypesHtml(res.fake_types)}</p>
    <h4>Full Analysis</h4>
    <p>${escapeHtml(res.analysis_text || '(none)')}</p>
    <h4>Reasoning</h4>
    <p>${escapeHtml(res.reasoning || '(none)')}</p>
  `;
}
