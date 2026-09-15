

const BACKEND_URL = ""; 

const MAX_VIDEO_DURATION_SECONDS = 180;

let videoDuration = 60;
let videoTime = 0;
let selectedVideoFile = null;

let currentSessionId = null;
let currentTranscriptSegments = [];  
let uploadPromise = null;           
let currentVideoFps = 0;
let currentVideoDuration = 0;
let currentScenes = [];             
let currentTemporalFrames = []; 
let currentCgiFrames = [];     


let currentVideoThumbnail = null; 

let detailDenseFramesCache = { temporal: null, cgi: null };

let currentDomainResults = { title: null, speech: null, temporal: null, cgi: null, crossModal: null, speechVideo: null };

let currentTitleClaimTexts = [];
let currentSpeechClaimTexts = [];

let currentTitleNumberedClaims = [];
let currentSpeechNumberedClaims = [];
let currentNumberedClaims = [];

let currentEvidence = [];

let currentTavilyEnabled = false;

function _captureFrameAt(sourceVideo, time, width = 480) {
  return new Promise((resolve) => {
    const tempVideo = document.createElement('video');
    tempVideo.src = sourceVideo.src;
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    const canvas = document.createElement('canvas');

    tempVideo.addEventListener('loadedmetadata', () => {
      const duration = tempVideo.duration || 0;
      canvas.width = width;
      canvas.height = Math.round(width * ((tempVideo.videoHeight || 9) / (tempVideo.videoWidth || 16))) || Math.round(width * 0.5625);
      tempVideo.currentTime = Math.min(time, Math.max(0, duration - 0.05));
    });
    tempVideo.addEventListener('seeked', () => {
      try {
        const c2d = canvas.getContext('2d');
        c2d.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height });
      } catch (e) {
        resolve(null);
      }
    }, { once: true });
    tempVideo.addEventListener('error', () => resolve(null));
  });
}

function _canvasBrightnessFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const c2d = canvas.getContext('2d');
      c2d.drawImage(img, 0, 0);
      const { data } = c2d.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0, count = 0;
      for (let i = 0; i < data.length; i += 4 * 37) {
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        count++;
      }
      resolve(count ? sum / count : 0);
    };
    img.onerror = () => resolve(0);
    img.src = dataUrl;
  });
}

const _BLACK_FRAME_THRESHOLD = 18; 
const _THUMBNAIL_MAX_FRAMES = 15;  

async function _findNonBlackFrame(sourceVideo) {
  const step = currentVideoFps > 0 ? 1 / currentVideoFps : 1 / 30;
  let last = null;
  for (let i = 0; i < _THUMBNAIL_MAX_FRAMES; i++) {
    const frame = await _captureFrameAt(sourceVideo, i * step);
    if (!frame) continue;
    last = frame;
    const brightness = await _canvasBrightnessFromDataUrl(frame.dataUrl);
    if (brightness > _BLACK_FRAME_THRESHOLD) return frame;
  }
  return last;
}

async function _initVideoThumbnail() {
  const sourceVideo = document.getElementById('videoPlayer');
  if (!sourceVideo || !sourceVideo.src) return;
  currentVideoThumbnail = await _findNonBlackFrame(sourceVideo);
  if (currentVideoThumbnail) sourceVideo.poster = currentVideoThumbnail.dataUrl;
}

function handleVideoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const probeUrl = URL.createObjectURL(file);
  const probe = document.createElement('video');
  probe.preload = 'metadata';
  probe.onloadedmetadata = () => {
    const duration = probe.duration || 0;
    URL.revokeObjectURL(probeUrl);
    if (duration > MAX_VIDEO_DURATION_SECONDS) {
      showVideoTooLongModal(duration);
      event.target.value = '';
      return;
    }
    _loadSelectedVideoFile(file);
  };
  probe.onerror = () => {
    URL.revokeObjectURL(probeUrl);
    
    _loadSelectedVideoFile(file);
  };
  probe.src = probeUrl;
}

function showVideoTooLongModal(durationSeconds) {
  const mins = Math.floor(durationSeconds / 60);
  const secs = Math.round(durationSeconds % 60);
  document.getElementById('videoTooLongBody').textContent =
    `Your video is ${mins} min ${secs} sec, which exceeds our 3-minute limit. Please choose a shorter video.`;
  document.getElementById('videoTooLongModalOverlay').classList.add('open');
}

function closeVideoTooLongModal() {
  document.getElementById('videoTooLongModalOverlay').classList.remove('open');
}

function _loadSelectedVideoFile(file, { caption } = {}) {
  
  
  
  
  resetForNewVideo();
  if (caption !== undefined) document.getElementById('captionBox').value = caption;

  selectedVideoFile = file;
  const url = URL.createObjectURL(file);
  const player = document.getElementById('videoPlayer');
  const zone = document.getElementById('videoZone');
  player.src = url;
  player.style.display = 'block';
  zone.classList.add('has-video');
  document.getElementById('videoControls').style.display = 'flex';
  player.onloadedmetadata = () => {
    videoDuration = player.duration || 60;
    updateTimeDisplay(0, videoDuration);
  };

  
  
  uploadPromise = uploadAndTranscribe();
}

function resetForNewVideo() {
  clearPanels();
  setStatus('IDLE', '');

  currentTranscriptSegments = [];
  currentVideoFps = 0;
  currentVideoDuration = 0;
  currentScenes = [];
  currentTemporalFrames = [];
  currentCgiFrames = [];
  currentVideoThumbnail = null;
  document.getElementById('videoPlayer').removeAttribute('poster');
  document.getElementById('captionBox').value = '';
  currentDomainResults = { title: null, speech: null, temporal: null, cgi: null, crossModal: null, speechVideo: null };
  currentTitleClaimTexts = [];
  currentSpeechClaimTexts = [];
  currentTitleNumberedClaims = [];
  currentSpeechNumberedClaims = [];
  currentNumberedClaims = [];
  currentEvidence = [];
  ['titleDetailBtn', 'speechDetailBtn', 'temporalDetailBtn', 'cgiDetailBtn', 'crossModalDetailBtn', 'speechVideoDetailBtn']
    .forEach(id => { const b = document.getElementById(id); if (b) b.style.display = 'none'; });

  document.getElementById('transcriptListLeft').innerHTML =
    '<div class="empty-state"><div class="empty-icon">📝</div>No transcript available.</div>';
  document.getElementById('transcriptCardStatus').innerHTML = '';


  if (currentSessionId) {
    fetch(`${BACKEND_URL}/session/${currentSessionId}`, { method: 'DELETE' }).catch(() => {});
  }
  currentSessionId = null;
}

async function uploadAndTranscribe() {
  currentSessionId = null;
  currentTranscriptSegments = [];
  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('transcriptCardStatus').innerHTML = '';
  startLoadingTimer('transcriptListLeft', 'Transcribing');

  
  
  
  
  
  const formData = new FormData();
  formData.append('video', selectedVideoFile);

  try {
    const upResp = await fetch(`${BACKEND_URL}/upload`, { method: 'POST', body: formData });
    if (!upResp.ok) throw new Error(await upResp.text());
    const upData = await upResp.json();
    currentSessionId = upData.session_id;
    currentVideoFps = upData.video_fps || 0;
    currentVideoDuration = upData.video_duration || 0;
    currentScenes = upData.scenes || [];

    
    
    
    _initVideoThumbnail();

    const asrResp = await fetch(`${BACKEND_URL}/asr?session_id=${currentSessionId}`, { method: 'POST' });
    if (!asrResp.ok) throw new Error(await asrResp.text());
    const asrData = await asrResp.json();
    currentTranscriptSegments = asrData.segments || [];
    renderCardStatus('transcriptCardStatus', finishTimer('transcriptListLeft'), null);
    renderTranscriptFromRaw(currentTranscriptSegments, []);
  } catch (err) {
    console.error('Upload/ASR failed', err);
    stopLoadingTimer('transcriptListLeft');
    document.getElementById('transcriptListLeft').innerHTML =
      `<div class="empty-state"><div class="empty-icon">⚠️</div>Transcript failed: ${escapeHtml(err.message)}</div>`;
  } finally {
    
    
    document.getElementById('analyzeBtn').disabled = false;
  }
}

function renderTranscriptFromRaw(segments, falseSpeechSpans) {
  if (!segments || !segments.length) {
    document.getElementById('transcriptListLeft').innerHTML =
      '<div class="empty-state"><div class="empty-icon">📝</div>No transcript available.</div>';
    return;
  }
  const spansLower = (falseSpeechSpans || []).map(s => s.toLowerCase());
  const mapped = segments.map(s => ({
    t: fmtTime(s.start),
    text: s.text,
    flag: spansLower.some(span => s.text.toLowerCase().includes(span)),
  }));
  renderTranscript(mapped);
}

function changeVideo(event) {
  event.stopPropagation();
  document.getElementById('videoFile').click();
}

function onVideoTimeUpdate() {
  const player = document.getElementById('videoPlayer');
  videoTime = player.currentTime;
  videoDuration = player.duration || 60;
  updateTimeDisplay(videoTime, videoDuration);
  updatePlayhead(videoTime / videoDuration);
  syncActiveTranscriptSegment(videoTime);
}

function seekVideo(delta) {
  const player = document.getElementById('videoPlayer');
  if (player.src) { player.currentTime = Math.max(0, player.currentTime + delta); }
  else { videoTime = Math.max(0, Math.min(videoDuration, videoTime + delta)); updatePlayhead(videoTime / videoDuration); }
}

function updateTimeDisplay(t, d) {
  const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  document.getElementById('timeDisplay').textContent = `${fmt(t)} / ${fmt(d)}`;
}

function updatePlayhead(ratio) {
  const ph = document.getElementById('playhead');
  if (ph) ph.style.left = (ratio * 100) + '%';
}

const _loadingTimers = {};
const _timerStarts = {};

function startLoadingTimer(elId, label = 'Analyzing') {
  const el = document.getElementById(elId);
  if (!el) return;
  stopLoadingTimer(elId);
  el.classList.add('is-loading');
  const startedAt = Date.now();
  _timerStarts[elId] = startedAt;
  const tick = () => {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    el.innerHTML = `<div class="loading-state"><span class="loading-dot"></span>${label}… ${secs}s</div>`;
  };
  tick();
  _loadingTimers[elId] = setInterval(tick, 1000);
}

function stopLoadingTimer(elId) {
  if (_loadingTimers[elId]) {
    clearInterval(_loadingTimers[elId]);
    delete _loadingTimers[elId];
  }
  const el = document.getElementById(elId);
  if (el) el.classList.remove('is-loading');
}

function finishTimer(elId) {
  const startedAt = _timerStarts[elId] || Date.now();
  stopLoadingTimer(elId);
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

function labelForFakeType(type) {
  const special = {
    contradictory_content: 'TITLE/VIDEO CONTRADICTORY CONTENT',
    unsupported_content: 'TITLE/VIDEO UNSUPPORTED CONTENT',
    speech_video_contradictory: 'SPEECH/VIDEO CONTRADICTORY CONTENT',
    speech_video_unsupported: 'SPEECH/VIDEO UNSUPPORTED CONTENT',
  };
  if (special[type]) return special[type];
  return String(type).replace(/_/g, ' ').toUpperCase();
}

function renderCardStatus(statusElId, elapsedSec, fakeTypes, notProvided = false) {
  const el = document.getElementById(statusElId);
  if (!el) return;
  let tagsHtml = '';
  if (fakeTypes !== null) {
    const tags = notProvided
      ? ['<span class="verdict-tag tag-neutral">N/A</span>']
      : (fakeTypes && fakeTypes.length)
        ? fakeTypes.map(t => `<span class="verdict-tag tag-fake">${escapeHtml(labelForFakeType(t))}</span>`)
        : ['<span class="verdict-tag tag-real">REAL</span>'];
    tagsHtml = tags.join('');
  }
  el.innerHTML = `<span class="finish-time">Finished in ${elapsedSec}s</span>${tagsHtml}`;
}

async function apiPost(path, formData) {
  const resp = await fetch(`${BACKEND_URL}${path}${path.includes('?') ? '&' : '?'}session_id=${currentSessionId}`, {
    method: 'POST',
    body: formData,  
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

async function apiGet(path) {
  const resp = await fetch(`${BACKEND_URL}${path}?session_id=${currentSessionId}`);
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

async function runAnalysis() {
  if (!selectedVideoFile) {
    alert('Please upload a video first.');
    return;
  }

  setStatus('ANALYZING', 'analyzing');
  clearPanels();

  
  if (uploadPromise) await uploadPromise;
  if (!currentSessionId) {
    setStatus('ERROR', 'error');
    document.getElementById('reasoningBox').innerHTML =
      `<span style="color:var(--deepfake)">Analysis failed: upload/transcript step did not complete.</span>`;
    return;
  }

  const caption = document.getElementById('captionBox').value || '';


  const temporalFramesPromise = extractSceneFrames(currentScenes, 'temporal');
  const cgiFramesPromise = extractSceneFrames(currentScenes, 'midpoint');

  let flaggedTypes = [];
  const flagIfFake = res => {
    if (res.fake_types && res.fake_types.length) {
      flaggedTypes = flaggedTypes.concat(res.fake_types);
      renderFakeTypeChips(flaggedTypes);
    }
  };

  
  
  
  
  try {
    
    
    
    
    
    
    revealSection('claimSectionLeft');
    
    
    
    
    const titleFormData = new FormData();
    titleFormData.append('title', caption);

    startLoadingTimer('claimUnitsTitle', 'Extracting title claims');
    const titleClaimsData = await apiPost('/claims/title', titleFormData);
    currentTitleClaimTexts = titleClaimsData.claims || [];
    renderCardStatus('claimTitleStatus', finishTimer('claimUnitsTitle'), null);
    document.getElementById('claimUnitsTitle').innerHTML = claimUnitsHtml(
      currentTitleClaimTexts.map((c, i) => ({ text: c, type: 'TITLE CLAIM', stance: 'neutral', num: i + 1 })),
      { emptyMessage: 'No claims extracted.' }
    );

    startLoadingTimer('claimUnitsSpeech', 'Extracting speech claims');
    document.getElementById('claimSpeechHead').style.display = '';
    document.getElementById('claimUnitsSpeech').style.display = '';
    const speechClaimsData = await apiPost('/claims/speech');
    currentSpeechClaimTexts = speechClaimsData.claims || [];
    renderCardStatus('claimSpeechStatus', finishTimer('claimUnitsSpeech'), null);
    document.getElementById('claimUnitsSpeech').innerHTML = claimUnitsHtml(
      currentSpeechClaimTexts.map((c, i) => ({ text: c, type: 'SPEECH CLAIM', stance: 'neutral', num: i + 1 })),
      { emptyMessage: 'No claims extracted.' }
    );

    
    
    
    
    
    
    
    
    
    revealSection('textAnalysisContainer');
    revealSection('titleCard');
    startLoadingTimer('titleAnalysis', 'Analyzing title');
    const titleRes = await apiPost('/domain/title');
    currentDomainResults.title = titleRes;
    renderCardStatus('titleCardStatus', finishTimer('titleAnalysis'), titleRes.fake_types || [], !caption.trim());
    renderTitleCard(caption, (titleRes.text_groundings && titleRes.text_groundings.false_title) || []);
    
    
    
    if (caption.trim()) document.getElementById('titleDetailBtn').style.display = '';
    flagIfFake(titleRes);

    
    
    currentTitleNumberedClaims = buildNumberedClaims(titleRes, 'title');
    currentNumberedClaims = [...currentTitleNumberedClaims, ...currentSpeechNumberedClaims];
    applyClaimHighlights('titleAnalysis', caption, currentTitleNumberedClaims);
    currentEvidence = currentEvidence.concat(mapDomainEvidence(titleRes.evidence));

    revealSection('speechCard');
    startLoadingTimer('speechAnalysis', 'Analyzing speech');
    const speechRes = await apiPost('/domain/speech');
    currentDomainResults.speech = speechRes;
    renderCardStatus('speechCardStatus', finishTimer('speechAnalysis'), speechRes.fake_types || []);
    renderSpeechCard(currentTranscriptSegments, (speechRes.text_groundings && speechRes.text_groundings.false_speech) || []);
    document.getElementById('speechDetailBtn').style.display = '';
    flagIfFake(speechRes);
    currentSpeechNumberedClaims = buildNumberedClaims(speechRes, 'speech');
    currentNumberedClaims = [...currentTitleNumberedClaims, ...currentSpeechNumberedClaims];
    const speechText = (currentTranscriptSegments && currentTranscriptSegments.length)
      ? currentTranscriptSegments.map(s => s.text).join(' ')
      : '(no transcript available)';
    applyClaimHighlights('speechAnalysis', speechText, currentSpeechNumberedClaims);
    currentEvidence = currentEvidence.concat(mapDomainEvidence(speechRes.evidence));

    
    revealSection('visualAnalysisContainer');
    revealSection('temporalCard');
    startLoadingTimer('temporalFrames', 'Analyzing temporal continuity');
    const temporalRes = await apiPost('/domain/temporal');
    currentDomainResults.temporal = temporalRes;
    currentTemporalFrames = await temporalFramesPromise;
    currentCgiFrames = await cgiFramesPromise;
    renderCardStatus('temporalCardStatus', finishTimer('temporalFrames'), temporalRes.fake_types || []);
    renderTemporalFrames(temporalRes.temporal_grounding || null);
    document.getElementById('temporalDetailBtn').style.display = '';
    flagIfFake(temporalRes);

    revealSection('cgiCard');
    startLoadingTimer('cgiFrames', 'Analyzing visual authenticity');
    const cgiRes = await apiPost('/domain/cgi');
    currentDomainResults.cgi = cgiRes;
    renderCardStatus('cgiCardStatus', finishTimer('cgiFrames'), cgiRes.fake_types || []);
    renderCgiFrames(cgiRes.cgi_grounding || null);
    document.getElementById('cgiDetailBtn').style.display = '';
    flagIfFake(cgiRes);

    revealSection('crossModalAnalysisContainer');
    revealSection('crossModalCard');
    startLoadingTimer('crossModalBox', 'Analyzing cross-modal consistency');
    const crossModalRes = await apiPost('/domain/cross_modal');
    currentDomainResults.crossModal = crossModalRes;
    renderCardStatus('crossModalCardStatus', finishTimer('crossModalBox'), crossModalRes.fake_types || [], !caption.trim());
    renderCrossModal(crossModalRes.analysis_text);
    
    
    
    if (caption.trim()) document.getElementById('crossModalDetailBtn').style.display = '';
    flagIfFake(crossModalRes);

    revealSection('speechVideoCard');
    startLoadingTimer('speechVideoBox', 'Analyzing speech vs. video consistency');
    const speechVideoRes = await apiPost('/domain/speech_video');
    currentDomainResults.speechVideo = speechVideoRes;
    renderCardStatus('speechVideoCardStatus', finishTimer('speechVideoBox'), speechVideoRes.fake_types || [], !(currentTranscriptSegments && currentTranscriptSegments.length));
    renderSpeechVideo(speechVideoRes.analysis_text);
    if (currentTranscriptSegments && currentTranscriptSegments.length) document.getElementById('speechVideoDetailBtn').style.display = '';
    flagIfFake(speechVideoRes);


    startLoadingTimer('evidenceList', 'Searching evidence');
    const finalData = await apiGet('/result');
    renderCardStatus('evidenceCardStatus', finishTimer('evidenceList'), null);
    renderFinalPanels(finalData);

    setStatus('COMPLETE', '');
  } catch (err) {
    console.error(err);
    setStatus('ERROR', 'error');
    Object.keys(_loadingTimers).forEach(stopLoadingTimer);
    document.getElementById('reasoningBox').innerHTML =
      `<span style="color:var(--deepfake)">Analysis failed: ${err.message}</span>`;
  }
}

function renderFinalPanels(data) {
  
  
  
  
  
  revealSection('verdictSection');
  revealSection('reasoningSection');
  document.querySelector('.decision-zone').classList.add('has-content');

  
  
  

  
  
  if (data.transcript && data.transcript.length) {
    renderTranscript(data.transcript);
  }
  
  
  
  
  
  
  
  if (data.evidence && data.evidence.length) {
    renderEvidence(data.evidence);
  } else {
    document.getElementById('evidenceList').innerHTML =
      '<div class="empty-state"><div class="empty-icon">📰</div>No evidence found.</div>';
  }
  renderVerdict(data);  
}

function renderFakeTypeChips(fakeTypes) {
  const labels = {
    false_title: 'False Title', false_speech: 'False Speech', temporal_edit: 'Temporal Edit',
    CGI: 'CGI / Synthetic', contradictory_content: 'Title/Video Contradictory Content', unsupported_content: 'Title/Video Unsupported Content',
    speech_video_contradictory: 'Speech/Video Contradictory Content', speech_video_unsupported: 'Speech/Video Unsupported Content',
  };
  const chipsEl = document.getElementById('fakeTypesRow');
  chipsEl.innerHTML = fakeTypes
    .map(t => `<span class="entity-tag" style="border-color:var(--deepfake-border);background:var(--deepfake-bg);color:var(--deepfake)">${labels[t] || t}</span>`)
    .join('');
}

function setStatus(text, cls) {
  const badge = document.getElementById('statusBadge');
  badge.textContent = text;
  badge.className = 'status-badge';
  if (cls === 'analyzing') {
    badge.style.cssText = 'background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;font-family:IBM Plex Mono,monospace;font-size:10px;padding:3px 8px;border-radius:100px;border:1px solid;';
    badge.classList.add('analyzing');
  } else if (cls === 'error') {
    badge.style.cssText = 'background:#fff1f2;border-color:#fca5a5;color:#dc2626;font-family:IBM Plex Mono,monospace;font-size:10px;padding:3px 8px;border-radius:100px;border:1px solid;';
  } else {
    badge.style.cssText = 'background:#ecfdf5;border-color:#6ee7b7;color:#059669;font-family:IBM Plex Mono,monospace;font-size:10px;padding:3px 8px;border-radius:100px;border:1px solid;';
  }
}

const REVEAL_SECTION_IDS = [
  'claimSectionLeft', 'textAnalysisContainer', 'visualAnalysisContainer',
  'crossModalAnalysisContainer', 'crossModalCard', 'speechVideoCard', 'verdictSection', 'reasoningSection', 'evidenceZone',
  'titleCard', 'speechCard', 'temporalCard', 'cgiCard',
];
function revealSection(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('revealed');
}
function hideSection(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('revealed');
}
function hideAllSections() {
  REVEAL_SECTION_IDS.forEach(hideSection);
  const dz = document.querySelector('.decision-zone');
  if (dz) dz.classList.remove('has-content');
}

function clearPanels() {
  hideAllSections();
  Object.keys(_loadingTimers).forEach(stopLoadingTimer);
  document.getElementById('claimUnitsTitle').innerHTML = '';
  document.getElementById('claimUnitsSpeech').innerHTML = '';
  document.getElementById('claimSpeechHead').style.display = 'none';
  document.getElementById('claimUnitsSpeech').style.display = 'none';
  document.getElementById('evidenceList').innerHTML = '';
  document.getElementById('titleAnalysis').innerHTML = '';
  document.getElementById('speechAnalysis').innerHTML = '';
  document.getElementById('temporalFrames').innerHTML = '';
  document.getElementById('cgiFrames').innerHTML = '';
  document.getElementById('crossModalBox').innerHTML = '';
  document.getElementById('speechVideoBox').innerHTML = '';
  document.getElementById('fakeTypesRow').innerHTML = '';
  ['claimTitleStatus', 'claimSpeechStatus', 'titleCardStatus', 'speechCardStatus', 'temporalCardStatus',
   'cgiCardStatus', 'crossModalCardStatus', 'speechVideoCardStatus', 'evidenceCardStatus'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });

  if (typeof detailDenseFramesCache !== 'undefined') {
    detailDenseFramesCache.temporal = null;
    detailDenseFramesCache.cgi = null;
  }
}

function fmtTime(s) {
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}

function parseTime(t) {
  const parts = String(t).split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number(t) || 0;
}

function seekToFrame(t) {
  const player = document.getElementById('videoPlayer');
  if (!player || !player.src) return;
  const seconds = parseTime(t);
  player.currentTime = Math.min(seconds, player.duration || seconds);
  updateTimeDisplay(player.currentTime, player.duration || videoDuration);
  player.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function buildSceneSampleTimes(scenes, fps) {
  const times = [];
  const hasFps = Number.isFinite(fps) && fps > 0;

  scenes.forEach(sc => {
    const start = Number(sc.start) || 0;
    const end = Number(sc.end) || start;
    const span = Math.max(0, end - start);
    if (span <= 0) {
      times.push(start);
      return;
    }

    const frameStep = hasFps ? (1 / fps) : Math.max(span / 20, 0.04);
    const maxT = Math.max(start, end - 0.001);
    const sceneTimes = [
      start,
      start + frameStep,
      start + (span / 2),
      end - (2 * frameStep),
      end - frameStep
    ].map(t => Math.min(maxT, Math.max(start, t)));

    sceneTimes.forEach(t => {
      if (!times.length || Math.abs(t - times[times.length - 1]) > 0.001) {
        times.push(t);
      }
    });
  });

  return times;
}

function buildSceneMidpointTimes(scenes) {
  return scenes.map(sc => {
    const start = Number(sc.start) || 0;
    const end = Number(sc.end) || start;
    return start + Math.max(0, end - start) / 2;
  });
}

function _extractFramesAtTimes(sampleTimes, canvasWidth = 160) {
  return new Promise((resolve) => {
    const sourceVideo = document.getElementById('videoPlayer');
    if (!sourceVideo || !sourceVideo.src || !sampleTimes || !sampleTimes.length) { resolve([]); return; }

    const tempVideo = document.createElement('video');
    tempVideo.src = sourceVideo.src;
    tempVideo.muted = true;
    tempVideo.playsInline = true;

    const canvas = document.createElement('canvas');
    const frames = [];
    let i = 0;

    const finish = () => resolve(frames);

    tempVideo.addEventListener('loadedmetadata', () => {
      const duration = tempVideo.duration || videoDuration || 0;
      if (!duration || !isFinite(duration)) { finish(); return; }
      canvas.width = canvasWidth;
      canvas.height = Math.round(canvasWidth * ((tempVideo.videoHeight || 9) / (tempVideo.videoWidth || 16))) || Math.round(canvasWidth * 0.625);
      seekNext();
    });

    function seekNext() {
      if (i >= sampleTimes.length) { finish(); return; }
      const duration = tempVideo.duration || videoDuration || 0;
      tempVideo.currentTime = Math.min(sampleTimes[i], Math.max(0, duration - 0.05));
    }

    tempVideo.addEventListener('seeked', () => {
      
      
      
      
      try {
        const ctx = canvas.getContext('2d');
        ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
        frames.push({ t: fmtTime(sampleTimes[i]), raw: sampleTimes[i], src: canvas.toDataURL('image/jpeg', 0.7) });
      } catch (e) {
        frames.push({ t: fmtTime(sampleTimes[i]), raw: sampleTimes[i], src: '' });
      }
      i++;
      seekNext();
    });

    tempVideo.addEventListener('error', finish);
  });
}

function extractSceneFrames(scenes, mode = 'temporal') {
  if (!scenes || !scenes.length) return Promise.resolve([]);
  const sampleTimes = mode === 'midpoint'
    ? buildSceneMidpointTimes(scenes)
    : buildSceneSampleTimes(scenes, currentVideoFps);
  return _extractFramesAtTimes(sampleTimes, 160).then(frames => dedupeFramesByTime(frames, 1));
}

function dedupeFramesByTime(frames, minGapSeconds = 1) {
  const result = [];
  let lastT = -Infinity;
  (frames || []).forEach(f => {
    const t = parseTime(f.t);
    if (result.length === 0 || t - lastT >= minGapSeconds) {
      result.push(f);
      lastT = t;
    }
  });
  return result;
}

const DETAIL_FRAME_STEP_SECONDS = 2;
const DETAIL_MAX_FRAMES = 400;
function buildDenseSampleTimes(duration, fps) {
  const dur = duration > 0 ? duration : 0;
  if (!dur) return [];
  const step = DETAIL_FRAME_STEP_SECONDS;
  const rawCount = Math.max(1, Math.floor(dur / step)) + 1;
  const stride = Math.max(1, Math.ceil(rawCount / DETAIL_MAX_FRAMES));
  const times = [];
  for (let i = 0; i < rawCount; i += stride) times.push(Math.min(dur, i * step));
  
  
  
  
  
  
  const last = times[times.length - 1];
  if (last === undefined) {
    times.push(dur);
  } else if (dur - last > step / 2) {
    times.push(dur);
  } else {
    times[times.length - 1] = dur;
  }
  return times;
}
function extractDenseFrames(duration, fps) {
  const sampleTimes = buildDenseSampleTimes(duration, fps);
  
  
  
  
  return _extractFramesAtTimes(sampleTimes, 120);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}


const _CLAIM_LINE_RE = /(?=Claim\s*\d+\s*:)/;
const _CLAIM_LABEL_RE = /^(Claim\s*\d+\s*:)\s*([\s\S]*)$/;
function formatClaimReasoningHtml(text) {
  const clean = (text || '').trim();
  if (!clean) return '<p>(none)</p>';
  const parts = clean.split(_CLAIM_LINE_RE).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return `<p>${escapeHtml(clean)}</p>`;
  return parts.map(part => {
    const m = part.match(_CLAIM_LABEL_RE);
    if (!m) return `<p>${escapeHtml(part)}</p>`;
    return `<p><strong>${escapeHtml(m[1])}</strong> ${escapeHtml(m[2].trim())}</p>`;
  }).join('');
}


function highlightSpans(text, spans) {
  const clean = (text || '').trim();
  if (!clean) return '<span style="color:var(--text3)">(empty)</span>';
  const validSpans = (spans || []).map(s => (s || '').trim()).filter(Boolean);
  if (!validSpans.length) return escapeHtml(clean);

  const escapeForRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sorted = [...validSpans].sort((a, b) => b.length - a.length);
  const re = new RegExp('(' + sorted.map(escapeForRegex).join('|') + ')', 'gi');

  let result = '';
  let lastIndex = 0;
  let m;
  while ((m = re.exec(clean)) !== null) {
    result += escapeHtml(clean.slice(lastIndex, m.index));
    result += `<span class="hl-error">${escapeHtml(m[0])}</span>`;
    lastIndex = re.lastIndex;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  result += escapeHtml(clean.slice(lastIndex));
  return result;
}


function renderTitleCard(title, spans) {
  const text = (title && title.trim()) ? title.trim() : '(no title provided)';
  document.getElementById('titleAnalysis').innerHTML = highlightSpans(text, spans);
}


function renderSpeechCard(transcriptSegments, spans) {
  const text = (transcriptSegments && transcriptSegments.length)
    ? transcriptSegments.map(s => s.text).join(' ')
    : '(no transcript available)';
  document.getElementById('speechAnalysis').innerHTML = highlightSpans(text, spans);
}



const _WORD_RE = /[^\w']+/;



function findBestMatchSpan(text, claimText) {
  const claim = (claimText || '').trim();
  if (!claim) return null;

  const tokens = [];
  const tokenRe = /\S+/g;
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    const word = m[0].toLowerCase().replace(/^[^\w']+|[^\w']+$/g, '');
    if (word) tokens.push({ word, start: m.index, end: m.index + m[0].length });
  }
  if (!tokens.length) return null;

  const claimWords = claim.toLowerCase().split(_WORD_RE).filter(Boolean);
  if (!claimWords.length) return null;
  const claimSet = new Set(claimWords);

  const minLen = Math.max(2, Math.round(claimWords.length * 0.5));

  
  
  
  const maxLen = Math.min(tokens.length, Math.round(claimWords.length * 1.2) + 2);

  let best = null;
  for (let len = minLen; len <= maxLen; len++) {
    for (let i = 0; i + len <= tokens.length; i++) {
      let overlap = 0;
      for (let j = i; j < i + len; j++) {
        if (claimSet.has(tokens[j].word)) overlap++;
      }
      if (overlap === 0) continue;
      const recall = overlap / claimWords.length;   
      const precision = overlap / len;               
      
      
      
      const score = (recall + precision > 0) ? (2 * recall * precision) / (recall + precision) : 0;
      if (!best || score > best.score) {
        best = { score, i, len };
      }
    }
  }
  
  
  if (!best || best.score < 0.35) return null;

  
  
  
  
  
  let lo = best.i;
  let hi = best.i + best.len - 1;
  while (lo < hi && !claimSet.has(tokens[lo].word)) lo++;
  while (hi > lo && !claimSet.has(tokens[hi].word)) hi--;

  return { score: best.score, start: tokens[lo].start, end: tokens[hi].end };
}

function buildNumberedClaims(domainResult, origin) {
  const claims = domainResult.claims || [];
  const fakeSet = new Set(domainResult.fake_claims || []);
  const type = origin === 'title' ? 'TITLE CLAIM' : 'SPEECH CLAIM';
  return claims.map((text, i) => ({
    text,
    type,
    stance: fakeSet.has(text) ? 'refute' : 'neutral',
    num: i + 1,
    _origin: origin,
  }));
}

function mapDomainEvidence(rawItems) {
  return (rawItems || [])
    .filter(e => e && e.url)
    .map(e => {
      let source = e.url;
      try { source = new URL(e.url).hostname.replace(/^www\./, ''); } catch (_) { /* keep raw url as fallback */ }
      return {
        title: e.title || '(untitled)',
        url: e.url,
        source,
        snippet: (e.content || '').slice(0, 220),
        stance: 'neutral',
        claim: e.claim || '',
      };
    });
}



function highlightClaims(text, claims) {
  const clean = (text || '').trim();
  if (!clean || !claims || !claims.length) return null;

  const spans = [];
  claims.forEach(c => {
    const span = findBestMatchSpan(clean, c.text);
    if (span) spans.push({ ...span, num: c.num, stance: c.stance || 'neutral', claimText: c.text });
  });
  if (!spans.length) return null;

  
  
  
  const boundaries = new Set([0, clean.length]);
  spans.forEach(s => { boundaries.add(s.start); boundaries.add(s.end); });
  const cuts = Array.from(boundaries).sort((a, b) => a - b);

  const rawSegments = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const segStart = cuts[i];
    const segEnd = cuts[i + 1];
    if (segStart >= segEnd) continue;
    const covering = spans.filter(s => s.start <= segStart && s.end >= segEnd);
    rawSegments.push({ start: segStart, end: segEnd, covering });
  }

  
  
  const segments = [];
  for (const seg of rawSegments) {
    const key = seg.covering.map(s => s.num).sort((a, b) => a - b).join(',');
    const prev = segments[segments.length - 1];
    if (prev && prev.key === key && prev.end === seg.start) {
      prev.end = seg.end;
    } else {
      segments.push({ ...seg, key });
    }
  }

  if (!segments.some(s => s.covering.length > 0)) return null;

  const stancePriority = { refute: 2, support: 1, neutral: 0 };
  let html = '';
  for (const seg of segments) {
    const chunk = clean.slice(seg.start, seg.end);
    if (!seg.covering.length) {
      html += escapeHtml(chunk);
      continue;
    }
    const stance = seg.covering.reduce(
      (acc, s) => (stancePriority[s.stance] > stancePriority[acc] ? s.stance : acc),
      'neutral'
    );
    const overlapClass = seg.covering.length > 1 ? ' claim-hl-overlap' : '';
    const nums = seg.covering.map(s => s.num).join(',');
    const titleText = seg.covering.map(s => s.claimText).join(' | ');
    html += `<mark class="claim-hl claim-${stance}${overlapClass}" data-claim-num="${nums}" title="${escapeHtml(titleText)}">`
          + `${escapeHtml(chunk)}<sup class="claim-hl-num">${nums}</sup></mark>`;
  }
  return html;
}


function applyClaimHighlights(elId, text, claims) {
  const el = document.getElementById(elId);
  if (!el) return;
  const html = highlightClaims(text, claims);
  if (html !== null) el.innerHTML = html;
}

function renderFrameGrid(elId, frames, flaggedRanges) {
  const el = document.getElementById(elId);
  if (!frames || !frames.length) {
    el.innerHTML = '<div class="empty-state" style="padding:12px;grid-column:1/-1"><div class="empty-icon" style="font-size:16px">🎞️</div>No frames extracted.</div>';
    return;
  }
  const ranges = flaggedRanges || [];
  el.innerHTML = frames.map((f, idx) => {
    const t = parseTime(f.t);
    const flagged = ranges.some(([s, e]) => t >= s && t <= e);
    return `
    <div class="frame-thumb ${flagged ? 'flagged' : ''}" title="Jump to ${f.t}" onclick="seekToFrame('${f.t}')">
      ${f.src ? `<img src="${f.src}" alt="frame ${idx}"/>` : ''}
      <span class="frame-time">${f.t}</span>
    </div>`;
  }).join('');
}



function renderTemporalFrames(temporalGrounding) {
  let ranges = [];
  if (temporalGrounding && temporalGrounding.transition_frames && currentVideoFps > 0) {
    ranges = temporalGrounding.transition_frames.map(fr => {
      const t = fr / currentVideoFps;
      return [Math.max(0, t - 1), t + 1];
    });
  }
  renderFrameGrid('temporalFrames', currentTemporalFrames, ranges);
}

function renderCgiFrames(cgiGrounding) {
  let ranges = [];
  if (cgiGrounding && cgiGrounding.frame_span && currentVideoFps > 0) {
    const [fs, fe] = cgiGrounding.frame_span;
    if (fe > fs) ranges = [[fs / currentVideoFps, fe / currentVideoFps]];
  }
  renderFrameGrid('cgiFrames', currentCgiFrames, ranges);
}

function renderCrossModal(text) {
  const el = document.getElementById('crossModalBox');
  el.innerHTML = (text && text.trim())
    ? escapeHtml(text.trim())
    : '<em style="color:var(--text3)">No cross-modal analysis available.</em>';
}

function renderSpeechVideo(text) {
  const el = document.getElementById('speechVideoBox');
  el.innerHTML = (text && text.trim())
    ? escapeHtml(text.trim())
    : '<em style="color:var(--text3)">No speech-vs-video analysis available.</em>';
}

function renderEvidence(items) {
  
  
  
  
  document.getElementById('evidenceList').innerHTML = items.map(e => `
    <a class="evidence-card fade-in" href="${e.url}" target="_blank" rel="noopener">
      <div class="ev-header">
        <div class="ev-title">${e.title}</div>
      </div>
      <div class="ev-source">🔗 ${e.source}</div>
      <div class="ev-snippet">${e.snippet}</div>
    </a>`).join('');
}

function renderTranscript(segments) {

  const html = segments.map(s => `
    <div class="transcript-seg" data-start="${parseTime(s.t)}" onclick="seekToFrame('${s.t}')">
      <div class="ts-time">${s.t}</div>
      <div class="ts-text">${s.text}</div>
    </div>`).join('');
  document.getElementById('transcriptListLeft').innerHTML = html;
}

let _activeTranscriptEl = null;
function syncActiveTranscriptSegment(currentTime) {
  const segEls = document.querySelectorAll('#transcriptListLeft .transcript-seg');
  if (!segEls.length) return;

  let activeEl = null;
  for (const el of segEls) {
    const start = parseFloat(el.dataset.start);
    if (!isNaN(start) && start <= currentTime + 0.05) {
      activeEl = el;
    } else {
      break; 
    }
  }

  if (activeEl === _activeTranscriptEl) return;
  if (_activeTranscriptEl) _activeTranscriptEl.classList.remove('active');
  if (activeEl) {
    activeEl.classList.add('active');
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  _activeTranscriptEl = activeEl;
}

function _normText(s) { return (s || '').trim().toLowerCase(); }

function _buildEvidenceIndex(evidenceItems) {
  const map = new Map();
  (evidenceItems || []).forEach(e => {
    const key = _normText(e.claim);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  });
  return map;
}



function claimUnitsHtml(claims, opts = {}) {
  const { emptyMessage, colorMode = 'origin', targetElId, evidence, compactEmpty } = opts;
  if (!claims || !claims.length) {
    
    
    
    
    
    return compactEmpty
      ? `<p style="color:var(--text3)">${emptyMessage || 'No claims extracted.'}</p>`
      : `<div class="empty-state" style="padding:12px"><div class="empty-icon" style="font-size:16px">🔎</div>${emptyMessage || 'No claims extracted.'}</div>`;
  }
  const evidenceIndex = (evidence && currentTavilyEnabled) ? _buildEvidenceIndex(evidence) : null;
  return claims.map(c => {
    let colorClass;
    if (colorMode === 'stance') {
      const st = c.stance || 'neutral';
      colorClass = st === 'support' ? 'claim-unit-support' : st === 'refute' ? 'claim-unit-refute' : 'claim-unit-neutral';
    } else {
      colorClass = /title/i.test(c.type || '') ? 'claim-unit-title' : 'claim-unit-speech';
    }
    const clickAttr = targetElId ? ` onclick="flashClaimMark('${targetElId}', ${c.num})"` : '';
    const clickableClass = targetElId ? ' claim-unit-clickable' : '';
    const claimEvidence = evidenceIndex ? (evidenceIndex.get(_normText(c.text)) || []) : [];

    
    const evidenceHtml = evidenceIndex
      ? (claimEvidence.length
          ? `
        <div class="claim-evidence-label">Evidence</div>
        <div class="claim-evidence">
          ${claimEvidence.map(e => `
          <a class="evidence-card claim-evidence-card" href="${e.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
            <div class="ev-header">
              <div class="ev-title">${e.title}</div>
            </div>
            <div class="ev-source">🔗 ${e.source}</div>
            ${e.snippet ? `<div class="ev-snippet">${e.snippet}</div>` : ''}
          </a>`).join('')}
        </div>`
          : `
        <div class="claim-evidence-label">Evidence</div>
        <div class="claim-evidence claim-evidence-empty">No evidence found.</div>`)
      : '';
    return `
    <div class="claim-unit fade-in ${colorClass}${clickableClass}"${clickAttr}>
      <div class="claim-unit-badge">${c.num != null ? c.num : '?'}</div>
      <div class="claim-body">
        <div class="claim-unit-text">${c.text}</div>
        ${evidenceHtml}
      </div>
    </div>`;
  }).join('');
}



function flashClaimMark(containerId, num) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const target = String(num);
  const marks = Array.from(container.querySelectorAll('mark[data-claim-num]'))
    .filter(el => el.dataset.claimNum.split(',').includes(target));
  if (!marks.length) return;
  marks.forEach(mark => {
    mark.classList.remove('claim-hl-flash');
    void mark.offsetWidth; 
    mark.classList.add('claim-hl-flash');
  });
  marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function _htmlToPlainText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || tmp.innerText || '').replace(/\s+\n/g, '\n').trim();
}

function _injectSuspiciousSegments() {
  if (typeof suspiciousSegmentsHtml !== 'function') return; 
  document.querySelectorAll('#reasoningBox .reasoning-domain').forEach(block => {
    const nameEl = block.querySelector('.reasoning-domain-name');
    const bodyEl = block.querySelector('.reasoning-domain-body');
    if (!nameEl || !bodyEl) return;
    const name = nameEl.textContent.trim().toLowerCase();
    let ranges = [];
    if (name === 'temporal') {
      ranges = _temporalFlaggedRanges((currentDomainResults.temporal || {}).temporal_grounding);
    } else if (name === 'cgi') {
      ranges = _cgiFlaggedRanges((currentDomainResults.cgi || {}).cgi_grounding);
    } else {
      return;
    }
    const html = suspiciousSegmentsHtml(ranges);
    if (html) bodyEl.insertAdjacentHTML('afterbegin', html);
  });
}

function renderVerdict(data) {
  
  
  
  const verdictColors = {
    REAL: { bg: 'var(--verified-bg)', border: 'var(--verified-border)', color: 'var(--verified)' },
    FAKE: { bg: 'var(--deepfake-bg)', border: 'var(--deepfake-border)', color: 'var(--deepfake)' }
  };
  const vc = verdictColors[data.verdict] || verdictColors.FAKE;

  const card = document.getElementById('verdictCard');
  card.style.background = vc.bg;
  card.style.borderColor = vc.border;
  card.style.color = vc.color; 

  const label = document.getElementById('verdictLabel');
  label.textContent = data.verdict;
  label.style.color = vc.color;
  document.getElementById('verdictIcon').textContent = data.icon;

  
  setTimeout(() => {
    const pct = data.conf.overall;
    document.getElementById('gaugeFill').style.strokeDashoffset = (113 - (113 * pct) / 100).toFixed(1);
    document.getElementById('gaugePct').textContent = pct + '%';
  }, 100);

  
  const chipsEl = document.getElementById('fakeTypesRow');
  if (data.verdict === 'FAKE' && data.fake_type_labels && data.fake_type_labels.length) {
    chipsEl.innerHTML = data.fake_type_labels
      .map(l => `<span class="entity-tag" style="border-color:var(--deepfake-border);background:var(--deepfake-bg);color:var(--deepfake)">${l}</span>`)
      .join('');
  } else {
    chipsEl.innerHTML = '';
  }


  currentTavilyEnabled = !!data.tavily_enabled;


  window.__lastReasoningData = data;
  document.getElementById('reasoningBox').innerHTML =
    buildReasoningDomainsHtml(data) || data.reasoning;

  document.getElementById('reasoningExportBtn').style.display = '';


  
  
  
  const evidenceZone = document.getElementById('evidenceZone');
  const decisionZone = document.querySelector('.decision-zone');
  const verdictSection = document.getElementById('verdictSection');
  const reasoningSection = document.getElementById('reasoningSection');
  evidenceZone.style.display = 'none';
  decisionZone.style.flex = '1 1 100%'; 
  verdictSection.style.flex = '0 0 auto'; 
  reasoningSection.style.flex = '1 1 auto'; 
}
