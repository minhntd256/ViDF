

const DEMOS_JSON_URL = 'demos/title.json';

let demoScenarios = null; 

function openDemosModal() {
  document.getElementById('demosModalOverlay').classList.add('open');
  document.addEventListener('keydown', _onDemosModalKeydown);
  if (demoScenarios === null) {
    _loadDemoScenarios();
  } else {
    _renderDemoList(); 
  }
}

function closeDemosModal() {
  document.getElementById('demosModalOverlay').classList.remove('open');
  document.removeEventListener('keydown', _onDemosModalKeydown);
}

function _onDemosModalKeydown(e) {
  if (e.key === 'Escape') closeDemosModal();
}

async function _loadDemoScenarios() {
  const body = document.getElementById('demosModalBody');
  body.innerHTML = '<p style="padding:16px 18px;color:var(--text3);font-size:12.5px;">Loading demos…</p>';
  try {
    const resp = await fetch(DEMOS_JSON_URL);
    if (!resp.ok) throw new Error(`${resp.status}`);
    const list = await resp.json();
    demoScenarios = Array.isArray(list) ? list : [];
  } catch (err) {
    console.error('Failed to load demos/title.json', err);
    demoScenarios = [];
    body.innerHTML = '<p style="padding:16px 18px;color:var(--text3);font-size:12.5px;">Couldn\'t load demo list.</p>';
    return;
  }
  _renderDemoList();
  _loadDemoThumbnails();
}

function _renderDemoList() {
  const body = document.getElementById('demosModalBody');
  if (!demoScenarios.length) {
    body.innerHTML = '<p style="padding:16px 18px;color:var(--text3);font-size:12.5px;">No demos available.</p>';
    return;
  }
  body.innerHTML = demoScenarios.map((s, i) => `
    <button class="demo-row" onclick="selectDemoScenario(${i})">
      <div class="demo-thumb" id="demoThumb${i}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </div>
      <div class="demo-info">
        <div class="demo-name">Demo ${i + 1}</div>
        <div class="demo-caption">${escapeHtml(s.title || '')}</div>
      </div>
    </button>`).join('');
}


async function _loadDemoThumbnails() {
  for (let i = 0; i < demoScenarios.length; i++) {
    const s = demoScenarios[i];
    const el = document.getElementById(`demoThumb${i}`);
    if (!el) continue; 
    try {
      const frame = await _findNonBlackFrame({ src: `demos/${s.filename}` });
      if (frame && el.isConnected) el.innerHTML = `<img src="${frame.dataUrl}" alt="">`;
    } catch (err) {
      console.error('Thumbnail extraction failed for', s.filename, err);
    }
  }
}

async function selectDemoScenario(index) {
  const s = demoScenarios && demoScenarios[index];
  if (!s) return;
  closeDemosModal();
  try {
    const resp = await fetch(`demos/${s.filename}`);
    if (!resp.ok) throw new Error(`${resp.status}`);
    const blob = await resp.blob();
    const file = new File([blob], s.filename, { type: blob.type || 'video/mp4' });
    _loadSelectedVideoFile(file, { caption: s.title || '' });
  } catch (err) {
    console.error('Failed to load demo video', s.filename, err);
    alert(`Could not load demo video "${s.filename}". Check your connection and try again.`);
  }
}
