/* ============================================================
   AI Pronunciation Trainer — callbacks.js  (v2)
   New in this version:
   - Persistent history via localStorage (survives reload)
   - Per-word mistake tracking saved to localStorage
   - Loading text shown inline in the Next button
   - All interactive elements disabled during any loading phase
   ============================================================ */

'use strict';

// ─── State ───────────────────────────────────────────────────────
let recordingReferenceSnapshot = null;

let mediaRecorder, audioChunks, audioBlob, stream, audioRecorded;
const ctx = new AudioContext();
let currentAudioForPlaying;
let lettersOfWordAreCorrect = [];

let currentSample   = 0;
let currentScore    = 0;
let sample_difficult = 1;
let scoreMultiplier  = 1;
let playAnswerSounds = true;
let isNativeSelectedForPlayback = true;
let isRecording = false;
let serverIsInitialized = false;
let serverWorking = true;
let languageFound = true;
let currentSoundRecorded = false;
let currentText = '';
let currentIpa  = '';
let real_transcripts_ipa    = [];
let matched_transcripts_ipa = [];
let wordCategories = [];
let startTime = '';
let endTime   = '';
let AILanguage = 'en';

const STScoreAPIKey  = 'rll5QsTiv83nti99BW6uCmvs9BDVxSB39SVFceYb';
const apiMainPathSample = '';
const apiMainPathSTS    = '';
const soundsPath = '../static';

let soundFileGood = null;
let soundFileOkay = null;
let soundFileBad  = null;

const accuracy_colors   = ['#22c55e', '#f59e0b', '#ef4444'];
const badScoreThreshold    = 30;
const mediumScoreThreshold = 70;

const page_title = 'AI Pronunciation Trainer';

// ─── Persistent History ──────────────────────────────────────────
const HISTORY_KEY     = 'pt_history_v2';
const MISTAKES_KEY    = 'pt_word_mistakes_v2';
const MAX_HISTORY     = 50;
const MAX_MISTAKES    = 500;

/** Load history array from localStorage */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Convert stored ISO-string times back to Date objects
    return parsed.map(h => ({ ...h, time: new Date(h.time) }));
  } catch (e) {
    return [];
  }
}

/** Save history array to localStorage */
function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(sessionHistory));
  } catch (e) { /* quota or private mode */ }
}

/** Load word-mistake records from localStorage */
function loadWordMistakes() {
  try {
    const raw = localStorage.getItem(MISTAKES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

/** Append new word-mistake records and persist */
function saveWordMistakes(newRecords) {
  try {
    let existing = loadWordMistakes();
    existing = existing.concat(newRecords);
    if (existing.length > MAX_MISTAKES) existing = existing.slice(-MAX_MISTAKES);
    localStorage.setItem(MISTAKES_KEY, JSON.stringify(existing));
  } catch (e) { /* quota */ }
}

// ─── Init session history from localStorage ──────────────────────
const sessionHistory = loadHistory();

// Mic visualizer
let analyserNode = null;
let vizRafId     = null;
let vizCanvas    = null;
let vizCtx       = null;

// Speech synthesis
const synth = window.speechSynthesis;
let voice_synth = null;

// ─── Theme ───────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
}

function toggleDarkMode() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('pt_theme', next); } catch (e) {}
}

(function () {
  let saved = 'dark';
  try { saved = localStorage.getItem('pt_theme') || 'dark'; } catch (e) {}
  applyTheme(saved);
})();

// ─── Loading Overlay ─────────────────────────────────────────────
function showLoading(msg) {
  const overlay = document.getElementById('loadingOverlay');
  const text    = document.getElementById('loadingText');
  if (text) text.textContent = msg || 'Processing...';
  if (overlay) overlay.classList.add('active');
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.remove('active');
}

// ─── Next Button Loading State ────────────────────────────────────
/**
 * Show or hide loading state in the Next button.
 * When loading, button shows a spinner + message and is disabled.
 */
function setNextButtonLoading(isLoading, msg) {
  const btn = document.getElementById('buttonNext');
  if (!btn) return;

  if (isLoading) {
    btn.disabled = true;
    btn.onclick  = null;
    btn.innerHTML = `
      <svg class="btn-spinner" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.75s" repeatCount="indefinite"/>
        </circle>
      </svg>
      ${msg || 'Loading…'}`;
  } else {
    btn.disabled = false;
    btn.onclick  = () => getNextSample();
    btn.innerHTML = `<span class="material-icons">arrow_forward</span>Next`;
  }
}

// ─── Status badge in header ──────────────────────────────────────
function setStatus(msg, type) {
  const el = document.getElementById('main_title');
  if (!el) return;
  el.textContent = msg;
  el.className = type ? `status-${type}` : '';
}

// ─── Score Ring ──────────────────────────────────────────────────
function updateScoreRing(pct) {
  const circumference = 2 * Math.PI * 40;
  const ringFill = document.getElementById('scoreRingFill');
  const ringText = document.getElementById('scoreRingText');
  if (!ringFill || !ringText) return;

  const offset = circumference - (Math.max(0, Math.min(100, pct)) / 100) * circumference;
  ringFill.style.strokeDashoffset = offset;

  let color;
  if (pct >= mediumScoreThreshold) color = '#22c55e';
  else if (pct >= badScoreThreshold) color = '#f59e0b';
  else color = '#ef4444';
  ringFill.style.stroke = color;
  ringText.textContent  = Math.round(pct) + '%';
  ringText.style.fill   = color;
}

function resetScoreRing() {
  const ringFill = document.getElementById('scoreRingFill');
  const ringText = document.getElementById('scoreRingText');
  if (ringFill) { ringFill.style.strokeDashoffset = '251.33'; ringFill.style.stroke = 'var(--accent)'; }
  if (ringText) { ringText.textContent = '—'; ringText.style.fill = 'var(--text)'; }
}

// ─── Session History (persistent) ────────────────────────────────
function addToHistory(sentence, score, lang) {
  sessionHistory.unshift({ sentence, score, lang, time: new Date() });
  if (sessionHistory.length > MAX_HISTORY) sessionHistory.pop();
  saveHistory();       // persist immediately
  renderHistoryPanel();
}

function renderHistoryPanel() {
  const list  = document.getElementById('historyList');
  const avgEl = document.getElementById('historyAvg');
  const badge = document.getElementById('historyBadge');

  if (!list) return;

  if (sessionHistory.length === 0) {
    list.innerHTML = `<div class="history-empty">
      Complete a sentence to see your history here.<br><br>
      Each attempt is tracked with its pronunciation score.
    </div>`;
    if (avgEl) avgEl.textContent = '';
    if (badge) badge.style.display = 'none';
    return;
  }

  if (badge) { badge.style.display = 'flex'; badge.textContent = sessionHistory.length; }

  const avg = Math.round(sessionHistory.reduce((s, h) => s + h.score, 0) / sessionHistory.length);
  if (avgEl) avgEl.textContent = `Avg ${avg}%`;

  const langLabels = { en: '🇬🇧', hi: '🇮🇳', mr: '🇮🇳' };

  list.innerHTML = sessionHistory.slice(0, 30).map((h) => {
    const cls     = h.score >= mediumScoreThreshold ? 'good' : h.score >= badScoreThreshold ? 'ok' : 'bad';
    const text    = h.sentence.length > 35 ? h.sentence.substring(0, 33) + '…' : h.sentence;
    const time    = h.time instanceof Date ? h.time : new Date(h.time);
    const mins    = Math.floor((Date.now() - time.getTime()) / 60000);
    const timeStr = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins/60)}h ago`;
    const langFlag = langLabels[h.lang] || '🌐';
    return `<div class="history-item">
      <span class="history-score-badge ${cls}">${h.score}%</span>
      <div class="history-info">
        <div class="history-sentence" title="${h.sentence.replace(/"/g,"'")}">${text}</div>
        <div class="history-meta">${langFlag} ${h.lang.toUpperCase()} · ${timeStr}</div>
      </div>
    </div>`;
  }).join('');
}

function toggleHistoryPanel() {
  const sidebar = document.getElementById('historySidebar');
  if (!sidebar) return;
  const current = sidebar.style.display;
  sidebar.style.display = current === 'flex' ? 'none' : 'flex';
}

// ─── Word Mistake Tracking ────────────────────────────────────────
/**
 * After each scored attempt, record per-word accuracy data.
 * words[]        - the real words (from sentence)
 * realIpas[]     - IPA for each real word
 * spokenIpas[]   - IPA for the transcribed word
 * categories[]   - 0=good, 1=ok, 2=bad per word
 * language       - language code
 */
function trackWordMistakes(words, realIpas, spokenIpas, categories, language) {
  if (!words || !words.length) return;
  const records = [];
  const ts = Date.now();
  for (let i = 0; i < words.length; i++) {
    const cat = parseInt(categories[i] || 2, 10);
    records.push({
      word:      words[i] || '',
      realIpa:   realIpas[i]   || '',
      spokenIpa: spokenIpas[i] || '',
      category:  cat,
      language:  language,
      timestamp: ts,
    });
  }
  saveWordMistakes(records);
}

// ─── Mic Visualizer ──────────────────────────────────────────────
function initMicVisualizer(micStream) {
  vizCanvas = document.getElementById('micVisualizer');
  if (!vizCanvas) return;
  try {
    const audioCtxViz = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtxViz.createMediaStreamSource(micStream);
    analyserNode = audioCtxViz.createAnalyser();
    analyserNode.fftSize = 128;
    analyserNode.smoothingTimeConstant = 0.7;
    source.connect(analyserNode);
    vizCtx = vizCanvas.getContext('2d');
    const dpr  = window.devicePixelRatio || 1;
    const rect = vizCanvas.getBoundingClientRect();
    vizCanvas.width  = (rect.width  || 400) * dpr;
    vizCanvas.height = (rect.height || 120) * dpr;
    vizCtx.scale(dpr, dpr);
    vizCanvas.style.width  = '100%';
    vizCanvas.style.height = '120px';
    drawViz();
  } catch (e) {
    console.warn('[MicViz] Failed to init:', e);
  }
}

function drawViz() {
  if (!analyserNode || !vizCtx || !vizCanvas) return;
  vizRafId = requestAnimationFrame(drawViz);

  const bufLen = analyserNode.frequencyBinCount;
  const data   = new Uint8Array(bufLen);
  analyserNode.getByteFrequencyData(data);

  const W = vizCanvas.width  / (window.devicePixelRatio || 1);
  const H = vizCanvas.height / (window.devicePixelRatio || 1);

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  vizCtx.fillStyle = isDark ? '#101826' : '#ffffff';
  vizCtx.fillRect(0, 0, W, H);

  const barCount = Math.min(bufLen, 48);
  const gap      = 2;
  const barW     = (W - gap * (barCount - 1)) / barCount;

  for (let i = 0; i < barCount; i++) {
    const v    = data[i] / 255;
    const barH = Math.max(3, v * H * 0.9);
    const x    = i * (barW + gap);
    const y    = H - barH;

    const hue   = isRecording ? 0 : 198;
    const sat   = isRecording ? 80 : 90;
    const lit   = 45 + v * 25;
    const alpha = isRecording ? 0.85 + v * 0.15 : 0.6 + v * 0.4;
    vizCtx.fillStyle = `hsla(${hue},${sat}%,${lit}%,${alpha})`;

    const radius = Math.min(barW / 2, 3);
    vizCtx.beginPath();
    vizCtx.moveTo(x + radius, y);
    vizCtx.lineTo(x + barW - radius, y);
    vizCtx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
    vizCtx.lineTo(x + barW, H);
    vizCtx.lineTo(x, H);
    vizCtx.lineTo(x, y + radius);
    vizCtx.quadraticCurveTo(x, y, x + radius, y);
    vizCtx.closePath();
    vizCtx.fill();
  }
}

function stopViz() {
  if (vizRafId) { cancelAnimationFrame(vizRafId); vizRafId = null; }
}

// ─── UI Block / Unblock ──────────────────────────────────────────
function unblockUI() {
  hideLoading();
  setNextButtonLoading(false);

  ['recordAudio', 'playSampleAudio'].forEach(id => {
    document.getElementById(id)?.classList.remove('disabled');
  });

  document.getElementById('original_script')?.classList.remove('disabled');

  if (currentSoundRecorded) {
    document.getElementById('playRecordedAudio')?.classList.remove('disabled');
  }
}

function blockUI(msg) {
  if (msg) showLoading(msg);
  ['recordAudio', 'playSampleAudio', 'playRecordedAudio'].forEach(id => {
    document.getElementById(id)?.classList.add('disabled');
  });

  const btn = document.getElementById('buttonNext');
  if (btn) { btn.disabled = true; btn.onclick = null; }

  document.getElementById('original_script')?.classList.add('disabled');
}

function UIError(msg) {
  hideLoading();
  setNextButtonLoading(false);
  setStatus('Error — try next sentence', '');

  const errText = msg ? String(msg) : 'Server error. Please try again.';
  const origEl  = document.getElementById('original_script');
  if (origEl) origEl.textContent = errText;

  ['ipa_script', 'recorded_ipa_script'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });

  const pairEl = document.getElementById('single_word_ipa_pair');
  if (pairEl) pairEl.textContent = 'Error';

  resetScoreRing();

  ['recordAudio', 'playSampleAudio', 'playRecordedAudio'].forEach(id => {
    document.getElementById(id)?.classList.add('disabled');
  });

  const btn = document.getElementById('buttonNext');
  if (btn) { btn.disabled = false; btn.onclick = () => getNextSample(); }
}

function UINotSupported() { setStatus('Browser unsupported', ''); unblockUI(); }
function UIRecordingError() { setStatus('Recording error — please try again', ''); unblockUI(); startMediaDevice(); }

// ─── Score helpers ───────────────────────────────────────────────
function updateHeaderScore(pct) {
  if (isNaN(pct)) return;
  currentScore += pct * scoreMultiplier;
  currentScore  = Math.round(currentScore);
}

// ─── Sound caching ───────────────────────────────────────────────
async function cacheSoundFiles() {
  const load = async (path) => {
    const buf = await fetch(path).then(r => r.arrayBuffer());
    return ctx.decodeAudioData(buf);
  };
  try {
    [soundFileGood, soundFileOkay, soundFileBad] = await Promise.all([
      load(soundsPath + '/ASR_good.wav'),
      load(soundsPath + '/ASR_okay.wav'),
      load(soundsPath + '/ASR_bad.wav'),
    ]);
  } catch (e) { console.warn('[Sounds] Could not cache sound files:', e); }
}

function playback(buffer) {
  if (!buffer) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(ctx.currentTime);
  } catch (e) { console.warn('[Playback]', e); }
}

async function playSoundForAnswerAccuracy(accuracy) {
  let buf = soundFileGood;
  if (accuracy < mediumScoreThreshold) buf = accuracy < badScoreThreshold ? soundFileBad : soundFileOkay;
  playback(buf);
}

// ─── Get Next Sample ─────────────────────────────────────────────
const getNextSample = async () => {
  // Show loading state directly in the button
  setNextButtonLoading(true, 'Fetching…');
  blockUI();   // also disables other controls; no overlay shown
  resetScoreRing();

  if (!serverIsInitialized) await initializeServer();
  if (!serverWorking) { UIError('Server unavailable. Please try later.'); return; }
  if (!soundFileGood) cacheSoundFiles();

  if      (document.getElementById('lengthCat1')?.checked) { sample_difficult = 0; scoreMultiplier = 1.3; }
  else if (document.getElementById('lengthCat2')?.checked) { sample_difficult = 1; scoreMultiplier = 1;   }
  else if (document.getElementById('lengthCat3')?.checked) { sample_difficult = 2; scoreMultiplier = 1.3; }
  else if (document.getElementById('lengthCat4')?.checked) { sample_difficult = 3; scoreMultiplier = 1.6; }

  try {
    setStatus('Fetching sample…', 'processing');

    const res = await fetch((apiMainPathSample || '') + '/getSample', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': STScoreAPIKey },
      body:    JSON.stringify({ category: sample_difficult.toString(), language: AILanguage }),
    });

    const text = await res.text();
    if (!res.ok)  throw new Error(`Server ${res.status}: ${text.slice(0, 120)}`);
    if (!text)    throw new Error('Empty response from server');

    const data = JSON.parse(text);
    if (data.error) throw new Error('Backend: ' + data.error);

    currentText = Array.isArray(data.real_transcript)
      ? data.real_transcript[0]
      : (data.real_transcript || '');
    currentIpa = data.ipa_transcript || '';

    const origEl   = document.getElementById('original_script');
    if (origEl)   origEl.textContent = currentText;

    const ipaEl = document.getElementById('ipa_script');
    if (ipaEl)   ipaEl.textContent = currentIpa ? `/ ${currentIpa} /` : '';

    const recIpaEl = document.getElementById('recorded_ipa_script');
    if (recIpaEl)  recIpaEl.textContent = '—';

    const pairEl = document.getElementById('single_word_ipa_pair');
    if (pairEl)   pairEl.textContent = 'Hover a word after recording';

    const scoreEl = document.getElementById('section_accuracy');
    if (scoreEl)  scoreEl.textContent = currentScore;

    currentSample++;
    currentSoundRecorded = false;

    setStatus(page_title, '');
    unblockUI();    // restores Next button text to "Next"
    document.getElementById('playRecordedAudio')?.classList.add('disabled');

  } catch (err) {
    console.error('[getNextSample]', err);
    UIError(err.message || String(err));
  }
};

// ─── Server Init ─────────────────────────────────────────────────
const initializeServer = async () => {
  let tries = 0;
  const maxTries = 4;
  setStatus('Initializing server…', 'processing');

  while (tries < maxTries) {
    try {
      await fetch(apiMainPathSTS + '/GetAccuracyFromRecordedAudio', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': STScoreAPIKey },
        body:    JSON.stringify({ title: '', base64Audio: '', language: AILanguage }),
      });
      serverIsInitialized = true;
      serverWorking = true;
      return;
    } catch (e) {
      tries++;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  serverWorking = false;
};

// Warm-up ping
try {
  fetch(apiMainPathSTS + '/GetAccuracyFromRecordedAudio', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': STScoreAPIKey },
    body: JSON.stringify({ title: '', base64Audio: '', language: AILanguage }),
  }).catch(() => {});
} catch (e) {}

// ─── Language ────────────────────────────────────────────────────
const changeLanguage = (language, generateNewSample = false) => {
  AILanguage  = language;
  languageFound = false;
  voice_synth   = null;

  const labels    = { en: 'English', de: 'German', hi: 'Hindi', mr: 'Marathi' };
  const voiceNames = { en: 'Daniel', de: 'Anna', hi: 'Rahul', mr: 'Narendra' };

  const langBoxEl = document.getElementById('languageBox');
  if (langBoxEl) langBoxEl.textContent = labels[language] || language;

  const voices     = synth.getVoices();
  const targetName = voiceNames[language] || '';

  for (const v of voices) {
    if (v.lang.startsWith(language) && v.name === targetName) { voice_synth = v; languageFound = true; break; }
  }
  if (!languageFound) {
    for (const v of voices) {
      if (v.lang.startsWith(language)) { voice_synth = v; languageFound = true; break; }
    }
  }

  if (generateNewSample) getNextSample();
};

// ─── Recording ───────────────────────────────────────────────────
const mediaStreamConstraints = {
  audio: {
    channelCount:    1,
    sampleRate:      16000,
    sampleSize:      16,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl:  true,
  }
};

const updateRecordingState = async () => {
  if (isRecording) {
    stopRecording();
  } else {
    if (!mediaRecorder) await startMediaDevice();
    recordSample();
  }
};

const recordSample = async () => {
  try {
    if (currentText) {
      recordingReferenceSnapshot = currentText.toString().trim();
    } else {
      const el = document.getElementById('original_script');
      recordingReferenceSnapshot = el ? el.textContent.trim() : '';
    }
  } catch (e) {
    recordingReferenceSnapshot = '';
  }

  setStatus('Recording… click mic again when done', 'recording');

  const micBtn = document.getElementById('recordAudio');
  if (micBtn) micBtn.classList.add('recording');

  const recordIcon = document.getElementById('recordIcon');
  if (recordIcon) recordIcon.textContent = 'stop';

  // Block everything except mic button
  ['playSampleAudio', 'playRecordedAudio', 'buttonNext'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (el.tagName === 'BUTTON') el.disabled = true;
      else el.classList?.add('disabled');
    }
  });
  // Show loading in button during recording
  setNextButtonLoading(true, 'Recording…');

  audioChunks = [];
  isRecording = true;

  if (mediaRecorder && mediaRecorder.state !== 'recording') {
    mediaRecorder.start();
  } else if (!mediaRecorder) {
    console.error('[recordSample] mediaRecorder not initialized');
    UIRecordingError();
  }
};

const stopRecording = () => {
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();

  const micBtn = document.getElementById('recordAudio');
  if (micBtn) micBtn.classList.remove('recording');

  // Update button to show scoring state
  setNextButtonLoading(true, 'Scoring…');
  setStatus('Processing audio…', 'processing');
  showLoading('Transcribing and scoring your pronunciation…');
};

// ─── Media Device Init ───────────────────────────────────────────
const startMediaDevice = async () => {
  try {
    stream        = await navigator.mediaDevices.getUserMedia(mediaStreamConstraints);
    mediaRecorder = new MediaRecorder(stream);

    initMicVisualizer(stream);

    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const micBtn = document.getElementById('recordAudio');
      if (micBtn) micBtn.classList.remove('recording');

      const recordIcon = document.getElementById('recordIcon');
      if (recordIcon) recordIcon.textContent = 'mic';

      audioBlob = new Blob(audioChunks, { type: 'audio/ogg;' });
      const audioUrl = URL.createObjectURL(audioBlob);
      audioRecorded  = new Audio(audioUrl);

      const audioBase64 = await convertBlobToBase64(audioBlob);

      let titleToSend = (recordingReferenceSnapshot && recordingReferenceSnapshot.length > 0)
        ? recordingReferenceSnapshot
        : (() => {
            const el = document.getElementById('original_script');
            return el ? el.textContent.replace(/\s\s+/g, ' ').trim() : '';
          })();

      titleToSend = titleToSend.toString().trim();

      if (!audioBase64 || audioBase64.length < 50) { UIRecordingError(); return; }

      try {
        const res = await fetch(apiMainPathSTS + '/GetAccuracyFromRecordedAudio', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': STScoreAPIKey },
          body:    JSON.stringify({ title: titleToSend, base64Audio: audioBase64, language: AILanguage }),
        });

        const data = await res.json();
        console.log('[SpeechToScore]', data);
        if (data.error) throw new Error(data.error);

        // ── IPA displays ──
        const recIpaEl = document.getElementById('recorded_ipa_script');
        if (recIpaEl) recIpaEl.textContent = data.ipa_transcript ? `/ ${data.ipa_transcript} /` : '—';

        const ipaEl = document.getElementById('ipa_script');
        if (ipaEl)   ipaEl.textContent = data.real_transcripts_ipa || '';

        // ── Score ring ──
        const score = parseFloat(data.pronunciation_accuracy || 0);
        updateScoreRing(score);

        // ── Persistent history ──
        addToHistory(titleToSend, Math.round(score), AILanguage);

        // ── Header score ──
        updateHeaderScore(score);
        const scoreEl = document.getElementById('section_accuracy');
        if (scoreEl) scoreEl.textContent = currentScore;

        // ── IPA / category arrays ──
        lettersOfWordAreCorrect = (data.is_letter_correct_all_words || '').split(' ');
        startTime = data.start_time || '';
        endTime   = data.end_time   || '';
        real_transcripts_ipa    = (data.real_transcripts_ipa    || '').split(' ');
        matched_transcripts_ipa = (data.matched_transcripts_ipa || '').split(' ');
        wordCategories          = (data.pair_accuracy_category  || '').split(' ');

        // ── Track word mistakes (persistent) ──
        const words = titleToSend.split(' ');
        trackWordMistakes(words, real_transcripts_ipa, matched_transcripts_ipa, wordCategories, AILanguage);

        // ── Color each word ──
        let coloredWords = '';
        for (let wi = 0; wi < words.length; wi++) {
          let wordHtml = '';
          const letterInfo = lettersOfWordAreCorrect[wi] || '';
          for (let li = 0; li < words[wi].length; li++) {
            const correct = letterInfo[li] === '1';
            const color   = correct ? '#22c55e' : '#ef4444';
            wordHtml += `<span style="color:${color}">${words[wi][li]}</span>`;
          }
          coloredWords += ' ' + wrapWordForIndividualPlayback(wordHtml, wi);
        }

        const origEl = document.getElementById('original_script');
        if (origEl) origEl.innerHTML = coloredWords;

        if (playAnswerSounds) playSoundForAnswerAccuracy(score);

        currentSoundRecorded = true;
        setStatus(page_title, '');
        unblockUI();
        document.getElementById('playRecordedAudio')?.classList.remove('disabled');

      } catch (err) {
        console.error('[onstop processing]', err);
        UIError(err.message || String(err));
      } finally {
        recordingReferenceSnapshot = null;
      }
    };

    console.log('[Media] Device ready');
    setStatus(page_title, '');
    unblockUI();

  } catch (err) {
    console.error('[startMediaDevice]', err);
    setStatus('Microphone access needed — please enable in browser settings', '');
    UINotSupported();
  }
};

startMediaDevice();

// ─── Audio Playback ──────────────────────────────────────────────
const playAudio = async () => {
  setStatus('Generating audio…', 'processing');
  playWithMozillaApi(typeof currentText === 'string' ? currentText : currentText[0] || '');
};

const playWithMozillaApi = (text) => {
  if (!languageFound) { UINotSupported(); return; }
  if (!text) return;
  blockUI('Playing audio…');
  if (!voice_synth) changeLanguage(AILanguage);
  const utt = new SpeechSynthesisUtterance(text);
  utt.voice = voice_synth;
  utt.rate  = 0.75;
  utt.onend = () => { unblockUI(); setStatus(page_title, ''); };
  synth.speak(utt);
};

const playRecording = async (start = null, end = null) => {
  if (!audioRecorded) return;
  blockUI();
  try {
    if (audioRecorded.readyState < 3) {
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 1000);
        audioRecorded.addEventListener('canplaythrough', () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }
    if (start == null || end == null) {
      audioRecorded.currentTime = 0;
      await audioRecorded.play().catch(e => { console.warn('[play]', e); });
      audioRecorded.addEventListener('ended', () => { audioRecorded.currentTime = 0; unblockUI(); setStatus('Recording played', ''); }, { once: true });
    } else {
      const dur = audioRecorded.duration || 0;
      const s = Math.max(0, Math.min(dur, start));
      const e = Math.max(s, Math.min(dur, end));
      audioRecorded.currentTime = s;
      await audioRecorded.play().catch(e => { console.warn('[play]', e); unblockUI(); });
      setTimeout(() => { try { audioRecorded.pause(); audioRecorded.currentTime = 0; } catch (e) {} unblockUI(); setStatus(page_title, ''); }, Math.round((e - s) * 1000));
    }
  } catch (err) { console.error('[playRecording]', err); unblockUI(); }
};

const playCurrentWord  = (word_idx) => {
  const words = (typeof currentText === 'string' ? currentText : currentText[0] || '').split(' ');
  if (word_idx < words.length) playWithMozillaApi(words[word_idx]);
};

const playRecordedWord = (word_idx) => {
  const s = parseFloat((startTime || '').split(' ')[word_idx] || 0);
  const e = parseFloat((endTime   || '').split(' ')[word_idx] || 0);
  playRecording(s, e);
};

const playNativeAndRecordedWord = (word_idx) => {
  if (isNativeSelectedForPlayback) playCurrentWord(word_idx);
  else playRecordedWord(word_idx);
  isNativeSelectedForPlayback = !isNativeSelectedForPlayback;
};

const generateWordModal = (word_idx) => {
  const refIpa = real_transcripts_ipa[word_idx]    || '?';
  const spoIpa = matched_transcripts_ipa[word_idx] || '?';
  const cat    = parseInt(wordCategories[word_idx] || 2);
  const color  = accuracy_colors[cat] || accuracy_colors[2];

  const pairEl = document.getElementById('single_word_ipa_pair');
  if (!pairEl) return;

  pairEl.innerHTML =
    `<a style="white-space:nowrap;color:var(--accent)" href="javascript:playCurrentWord(${word_idx})">${refIpa}</a>` +
    ` | ` +
    `<a style="white-space:nowrap;color:${color}" href="javascript:playRecordedWord(${word_idx})">${spoIpa}</a>`;
};

// ─── Helpers ─────────────────────────────────────────────────────
const convertBlobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload  = () => resolve(reader.result.split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const wrapWordForIndividualPlayback = (wordHtml, word_idx) =>
  `<a onmouseover="generateWordModal(${word_idx})" style="white-space:nowrap;cursor:pointer;" href="javascript:playNativeAndRecordedWord(${word_idx})">${wordHtml}</a> `;

const wrapWordForPlayingLink = (word, word_idx, isFromRecording, color) => {
  const fn = isFromRecording ? 'playRecordedWord' : 'playCurrentWord';
  return `<a style="white-space:nowrap;color:${color}" href="javascript:${fn}(${word_idx})">${word}</a> `;
};

// ─── Resize visualizer ───────────────────────────────────────────
window.addEventListener('resize', () => {
  if (!vizCanvas || !vizCtx) return;
  const dpr  = window.devicePixelRatio || 1;
  const rect = vizCanvas.getBoundingClientRect();
  vizCanvas.width  = rect.width  * dpr;
  vizCanvas.height = rect.height * dpr;
  vizCtx.scale(dpr, dpr);
});

// ─── Init on load ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  let saved = 'dark';
  try { saved = localStorage.getItem('pt_theme') || 'dark'; } catch (e) {}
  applyTheme(saved);
  renderHistoryPanel();    // render loaded history
});