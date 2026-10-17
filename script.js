/**
 * Glücksrad – Hauptskript
 * Features:
 * - Dynamisches HTML5 Canvas Glücksrad (Farben, Texte, optionale Bilder, Gewichtung)
 * - Einfacher Text-Editor (1 Zeile = 1 Option) & Erweiterter Modus (Farbe, Bild, Gewicht pro Option)
 * - Eigener Song während der Drehung (MP3/WAV/OGG Upload, Startpunkt, Lautstärke, sanftes Fade-Out)
 * - Integrierter Synthesizer-Fallback (Melodie, Zeiger-Klackern, Gewinner-Fanfare & Applaus)
 * - Persistenz über LocalStorage & IndexedDB (speichert auch hochgeladene Audiodateien im Browser)
 * - Gewinner-Historie aller gezogenen Optionen & Konfetti-Animation
 */

// --- Farbpaletten ---
const COLOR_PALETTES = {
  // Orientiert an Screenshot 1 (Rot, Orange, Grün, Blau...)
  classic: ['#e52421', '#ef7d1a', '#259b24', '#3369e8', '#9b51e0', '#00acc1'],
  vibrant: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de'],
  pastel: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'],
  neon: ['#ff007f', '#00f5d4', '#fee440', '#9b5de5', '#00bbf9', '#f15bb5'],
  ocean: ['#0077b6', '#0096c7', '#00b4d8', '#48cae4', '#90e0ef', '#023e8a']
};

const POPULAR_EMOJIS = [
  '🎉', '🔥', '⭐', '🍕', '🍔', '🍦', '🍺', '🎮', '🎬', '🎵', '🏆', '💎',
  '🚀', '🌈', '🍀', '❤️', '😂', '😎', '🥳', '🎁', '💰', '🏖️', '⚽', '🎲'
];

// --- Standard-Zustand ---
const DEFAULT_STATE = {
  entries: [
    { id: '1', text: 'Auswahl 1', color: '#e52421', weight: 1, enabled: true, image: null },
    { id: '2', text: 'Auswahl 2', color: '#ef7d1a', weight: 1, enabled: true, image: null },
    { id: '3', text: 'Auswahl 3', color: '#259b24', weight: 1, enabled: true, image: null }
  ],
  removedEntries: [],
  history: [],
  settings: {
    spinDuration: 8,         // Sekunden
    spinPower: 8,            // Basis-Umdrehungen
    enableSpinMusic: true,
    musicSourceType: 'custom', // 'custom' | 'synth'
    songStartOffset: 0,      // Sekunden
    musicVolume: 80,         // 0 - 100
    musicFadeOut: true,
    enableTickSound: false,
    enableWinnerSound: true,
    winnerVolume: 85,        // 0 - 100
    colorPalette: 'classic',
    centerRadiusPct: 18,     // % des Radius
    enableConfetti: true,
    darkMode: false,
    advancedMode: false
  }
};

let state = loadStateFromStorage();

// --- Laufzeit-Variablen für Drehung & Audio ---
let currentAngle = 0.25; // Startwinkel in Radiant
let isSpinning = false;
let spinAnimationFrame = null;
let lastWinnerEntry = null;
let sortAscending = true;

// Geladene Bild-Objekte für Canvas-Segmente (id -> HTMLImageElement)
const loadedSegmentImages = new Map();

// Audio-Elemente & Web Audio API
let audioCtx = null;
let customSpinAudio = new Audio();
customSpinAudio.preload = 'auto';
let customSpinAudioLoaded = false;
let customSpinAudioName = '';
let fadeOutInterval = null;
let previewTimeout = null;
let isPreviewPlaying = false;

let customWinnerAudio = new Audio();
customWinnerAudio.preload = 'auto';
let customWinnerAudioLoaded = false;
let customWinnerAudioName = '';

let synthMelodyInterval = null;

// --- IndexedDB für das dauerhafte Speichern hochgeladener Songs ---
const DB_NAME = 'GluecksradAudioDB';
const DB_STORE = 'audioFiles';

function openAudioDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveAudioToDB(key, fileBlob, fileName) {
  try {
    const db = await openAudioDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put({ blob: fileBlob, name: fileName }, key);
  } catch (err) {
    console.warn('Audio konnte nicht in IndexedDB gespeichert werden:', err);
  }
}

async function loadAudioFromDB(key) {
  try {
    const db = await openAudioDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

async function deleteAudioFromDB(key) {
  try {
    const db = await openAudioDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
  } catch (err) {
    // Ignorieren
  }
}

// --- LocalStorage Laden & Speichern ---
function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem('gluecksrad_state_v1');
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed.entries) && parsed.entries.length > 0
        ? parsed.entries
        : structuredClone(DEFAULT_STATE.entries),
      removedEntries: Array.isArray(parsed.removedEntries) ? parsed.removedEntries : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) }
    };
  } catch (e) {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveStateToStorage() {
  try {
    localStorage.setItem('gluecksrad_state_v1', JSON.stringify(state));
  } catch (e) {
    console.warn('LocalStorage Speicherlimit erreicht oder blockiert:', e);
  }
}

// --- Hilfsfunktionen ---
function generateId() {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

function getPaletteColor(index) {
  const palette = COLOR_PALETTES[state.settings.colorPalette] || COLOR_PALETTES.classic;
  return palette[index % palette.length];
}

// Berechnet automatisch, ob Weiß oder Schwarz auf einer Segmentfarbe besser lesbar ist (wie in Screenshot 1)
function getContrastTextColor(hexColor) {
  if (!hexColor || !hexColor.startsWith('#')) return '#ffffff';
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  // Wahrgenommene Helligkeit
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.53 ? '#000000' : '#ffffff';
}

function getActiveEntries() {
  return state.entries.filter((e) => e.enabled !== false && e.text.trim().length > 0);
}

function preloadEntryImages() {
  state.entries.forEach((entry) => {
    if (entry.image && !loadedSegmentImages.has(entry.image)) {
      const img = new Image();
      img.onload = () => drawWheel();
      img.src = entry.image;
      loadedSegmentImages.set(entry.image, img);
    }
  });
}

// --- DOM-Elemente ---
const wheelCanvas = document.getElementById('wheelCanvas');
const ctx = wheelCanvas.getContext('2d');
const wheelWrapper = document.getElementById('wheelWrapper');
const wheelPointer = document.getElementById('wheelPointer');
const pointerPolygon = document.getElementById('pointerPolygon');
const spinBtn = document.getElementById('spinBtn');

const entriesTextarea = document.getElementById('entriesTextarea');
const entriesCountPill = document.getElementById('entriesCountPill');
const simpleEditorContainer = document.getElementById('simpleEditorContainer');
const advancedEditorContainer = document.getElementById('advancedEditorContainer');
const advancedEntriesList = document.getElementById('advancedEntriesList');
const advancedModeBtn = document.getElementById('advancedModeBtn');

const historyCountBadge = document.getElementById('historyCountBadge');
const historyList = document.getElementById('historyList');
const restoreRemovedBtn = document.getElementById('restoreRemovedBtn');

// --- Glücksrad Zeichnen (Canvas) ---
function drawWheel() {
  const width = wheelCanvas.width;
  const height = wheelCanvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const outerRadius = Math.min(cx, cy) - 10;
  const innerRadius = (outerRadius * (state.settings.centerRadiusPct || 0)) / 100;

  ctx.clearRect(0, 0, width, height);

  const activeEntries = getActiveEntries();

  if (activeEntries.length === 0) {
    // Leeres Rad anzeigen
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#cfd8dc';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#78909c';
    ctx.stroke();

    ctx.fillStyle = '#37474f';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Bitte Auswahl-Optionen eingeben', cx, cy);
    return;
  }

  const totalWeight = activeEntries.reduce((sum, item) => sum + (Number(item.weight) || 1), 0);
  let startAngle = currentAngle;

  // Welches Segment liegt aktuell beim Zeiger (Winkel 0 rechts)?
  let pointerSegmentColor = '#ef7d1a';

  activeEntries.forEach((entry, index) => {
    const weight = Number(entry.weight) || 1;
    const sliceAngle = (weight / totalWeight) * (Math.PI * 2);
    const endAngle = startAngle + sliceAngle;
    const fillColor = entry.color || getPaletteColor(index);

    // Prüfen, ob Winkel 0 (Zeiger rechts) in diesem Segment liegt
    const normStart = ((startAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const normEnd = normStart + sliceAngle;
    if (normStart === 0 || (normStart <= Math.PI * 2 && normEnd >= Math.PI * 2)) {
      pointerSegmentColor = fillColor;
    }

    // 1. Segment-Fläche zeichnen
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerRadius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Feine dunkle Trennlinie zwischen den Segmenten (wie in Screenshot 1)
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(30, 30, 30, 0.55)';
    ctx.stroke();

    // 2. Optionales Segment-Bild + Text entlang der Winkelhalbierenden
    const midAngle = startAngle + sliceAngle / 2;
    ctx.translate(cx, cy);
    ctx.rotate(midAngle);

    // Falls ein Bild für dieses Segment vorhanden ist
    if (entry.image && loadedSegmentImages.has(entry.image)) {
      const img = loadedSegmentImages.get(entry.image);
      if (img.complete && img.naturalWidth > 0) {
        const imgSize = Math.min(64, Math.max(28, sliceAngle * outerRadius * 0.35));
        const imgDist = innerRadius + (outerRadius - innerRadius) * 0.34;
        ctx.save();
        ctx.beginPath();
        ctx.arc(imgDist, 0, imgSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, imgDist - imgSize / 2, -imgSize / 2, imgSize, imgSize);
        ctx.restore();
      }
    }

    // Textgröße dynamisch an Segmentanzahl und Textlänge anpassen
    const text = entry.text.trim();
    const ringWidth = outerRadius - innerRadius;
    const maxTextWidth = ringWidth - (entry.image ? 85 : 32);
    let fontSize = Math.min(38, Math.max(12, Math.floor((sliceAngle * outerRadius) * 0.24)));
    if (activeEntries.length <= 5) {
      fontSize = Math.min(40, Math.max(24, fontSize));
    }

    ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    while (ctx.measureText(text).width > maxTextWidth && fontSize > 11) {
      fontSize -= 1;
      ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    }

    // Textfarbe (Schwarz oder Weiß je nach Hintergrund-Kontrast, wie in Screenshot 1)
    ctx.fillStyle = getContrastTextColor(fillColor);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Text abschneiden falls immer noch zu lang
    let displayText = text;
    if (ctx.measureText(displayText).width > maxTextWidth) {
      while (displayText.length > 1 && ctx.measureText(displayText + '…').width > maxTextWidth) {
        displayText = displayText.slice(0, -1);
      }
      displayText += '…';
    }

    const textRadius = entry.image
      ? innerRadius + ringWidth * 0.66
      : innerRadius + ringWidth * 0.54;
    ctx.fillText(displayText, textRadius, 0);
    ctx.restore();

    startAngle = endAngle;
  });

  // Äußerer Rahmen des Rades
  ctx.beginPath();
  ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(40, 40, 40, 0.65)';
  ctx.stroke();

  // Weißer Mittelkreis mit sanftem Innenschatten (exakt wie in Screenshot 1)
  if (innerRadius > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Schattierung am inneren Rand des Mittelkreises für den 3D-Loch-Effekt
    const grad = ctx.createRadialGradient(cx, cy, innerRadius * 0.65, cx, cy, innerRadius);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(60, 60, 60, 0.55)';
    ctx.stroke();
    ctx.restore();
  }

  // Zeigerfarbe dynamisch an das aktuelle Segment am Zeiger anpassen (wie in Screenshot 1)
  const pointedSeg = getSegmentAtPointer(currentAngle);
  if (pointerPolygon && pointedSeg) {
    const segColor = pointedSeg.entry.color || getPaletteColor(pointedSeg.index);
    pointerPolygon.setAttribute('fill', segColor);
  }
}

// Ermittelt das Gewinner-Segment beim aktuellen Drehwinkel (Zeiger steht rechts auf 0 Radiant)
function getSegmentAtPointer(angle) {
  const activeEntries = getActiveEntries();
  if (activeEntries.length === 0) return null;

  const totalWeight = activeEntries.reduce((sum, item) => sum + (Number(item.weight) || 1), 0);
  // Zeiger ist bei 0 Radiant; relativ zum gedrehten Rad entspricht das (2*PI - (angle mod 2*PI)) mod 2*PI
  const twoPi = Math.PI * 2;
  const pointerRelAngle = (twoPi - ((angle % twoPi) + twoPi) % twoPi) % twoPi;

  let accAngle = 0;
  for (let i = 0; i < activeEntries.length; i++) {
    const weight = Number(activeEntries[i].weight) || 1;
    const sliceAngle = (weight / totalWeight) * twoPi;
    if (pointerRelAngle >= accAngle && pointerRelAngle < accAngle + sliceAngle) {
      return { entry: activeEntries[i], index: i };
    }
    accAngle += sliceAngle;
  }
  return { entry: activeEntries[activeEntries.length - 1], index: activeEntries.length - 1 };
}

// --- Web Audio API & Eigene Musik Steuerung ---
function ensureAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Kurzes Klack-Geräusch, wenn ein Segment den Zeiger passiert
function playTickSound() {
  if (!state.settings.enableTickSound) return;
  ensureAudioContext();
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(520, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(140, audioCtx.currentTime + 0.035);

  const vol = (state.settings.musicVolume / 100) * 0.25;
  gain.gain.setValueAtTime(Math.max(0.01, vol), audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.035);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.04);
}

// Integrierte fröhliche Glücksrad-Melodie falls kein eigener Song hochgeladen wurde oder "Integrierte Melodie" gewählt ist
function startSynthSpinMelody() {
  stopSynthSpinMelody();
  ensureAudioContext();
  if (!audioCtx) return;

  const notes = [261.63, 329.63, 392.00, 523.25, 392.00, 329.63, 293.66, 349.23, 440.00, 587.33, 440.00, 349.23];
  let step = 0;

  synthMelodyInterval = setInterval(() => {
    if (!isSpinning || !state.settings.enableSpinMusic) {
      stopSynthSpinMelody();
      return;
    }
    const freq = notes[step % notes.length];
    step++;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    const vol = (state.settings.musicVolume / 100) * 0.18;
    gain.gain.setValueAtTime(Math.max(0.005, vol), audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.16);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.17);
  }, 180);
}

function stopSynthSpinMelody() {
  if (synthMelodyInterval) {
    clearInterval(synthMelodyInterval);
    synthMelodyInterval = null;
  }
}

// Startet die gewählte Musik zu Beginn der Drehung
function startSpinMusic(spinDurationSec) {
  stopSpinMusicImmediate();
  if (!state.settings.enableSpinMusic) return;

  const targetVolume = Math.min(1, Math.max(0, state.settings.musicVolume / 100));

  // Wenn "Eigener Song" aktiv und eine Datei geladen ist
  if (state.settings.musicSourceType === 'custom' && customSpinAudioLoaded) {
    try {
      const startOffset = Number(state.settings.songStartOffset) || 0;
      customSpinAudio.currentTime = Math.min(
        startOffset,
        Math.max(0, (customSpinAudio.duration || startOffset) - 0.5)
      );
    } catch (e) {
      customSpinAudio.currentTime = 0;
    }
    customSpinAudio.volume = targetVolume;
    customSpinAudio.loop = true;
    customSpinAudio.play().catch((err) => {
      console.warn('Audio-Wiedergabe konnte nicht gestartet werden:', err);
    });

    // Optionales sanftes Ausblenden (Fade-Out) in den letzten 1,2 Sekunden der Drehung
    if (state.settings.musicFadeOut && spinDurationSec > 1.8) {
      const fadeDurationMs = 1200;
      const fadeStartMs = Math.max(0, spinDurationSec * 1000 - fadeDurationMs);
      setTimeout(() => {
        if (!isSpinning) return;
        const steps = 20;
        const stepTime = fadeDurationMs / steps;
        let currentStep = 0;
        clearInterval(fadeOutInterval);
        fadeOutInterval = setInterval(() => {
          currentStep++;
          const nextVol = targetVolume * (1 - currentStep / steps);
          customSpinAudio.volume = Math.max(0, nextVol);
          if (currentStep >= steps) {
            clearInterval(fadeOutInterval);
          }
        }, stepTime);
      }, fadeStartMs);
    }
  } else {
    // Integrierte Synthesizer-Melodie abspielen
    startSynthSpinMelody();
  }
}

function stopSpinMusicImmediate() {
  clearInterval(fadeOutInterval);
  clearTimeout(previewTimeout);
  isPreviewPlaying = false;
  updatePreviewButtonUI();

  if (customSpinAudioLoaded) {
    customSpinAudio.pause();
  }
  stopSynthSpinMelody();
}

// Gewinner-Sound (Eigene Datei oder Feier-Fanfare + Applaus)
function playWinnerCelebrationSound() {
  if (!state.settings.enableWinnerSound) return;

  const vol = Math.min(1, Math.max(0, state.settings.winnerVolume / 100));

  if (customWinnerAudioLoaded) {
    customWinnerAudio.currentTime = 0;
    customWinnerAudio.volume = vol;
    customWinnerAudio.play().catch(() => {});
    return;
  }

  // Integrierte Fanfare + Applaus-Rauschen über Web Audio API
  ensureAudioContext();
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const fanfareNotes = [
    { freq: 523.25, time: 0.0, dur: 0.14 }, // C5
    { freq: 659.25, time: 0.15, dur: 0.14 }, // E5
    { freq: 783.99, time: 0.30, dur: 0.14 }, // G5
    { freq: 1046.50, time: 0.45, dur: 0.55 } // C6
  ];

  fanfareNotes.forEach((n) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(n.freq, now + n.time);

    gain.gain.setValueAtTime(Math.max(0.01, vol * 0.35), now + n.time);
    gain.gain.exponentialRampToValueAtTime(0.001, now + n.time + n.dur);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now + n.time);
    osc.stop(now + n.time + n.dur + 0.02);
  });

  // Kurzer Applaus-Effekt (gefiltertes Noise-Bursting)
  const bufferSize = audioCtx.sampleRate * 1.4;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.6));
  }

  const whiteNoise = audioCtx.createBufferSource();
  whiteNoise.buffer = noiseBuffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1200;

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(vol * 0.22, now + 0.25);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

  whiteNoise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  whiteNoise.start(now + 0.25);
}

// --- Rad Drehen Logik ---
function spinWheel() {
  if (isSpinning) return;
  const activeEntries = getActiveEntries();
  if (activeEntries.length === 0) return;

  isSpinning = true;
  spinBtn.disabled = true;

  const durationSec = Math.max(1, Number(state.settings.spinDuration) || 8);
  const durationMs = durationSec * 1000;
  const baseRotations = Math.max(2, Number(state.settings.spinPower) || 8);

  // Zufälliger Zusatzwinkel (Kryptographisch zufällig falls verfügbar)
  let randomFraction = Math.random();
  if (window.crypto && window.crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    randomFraction = arr[0] / (0xffffffff + 1);
  }

  // Gesamtrotation skaliert auch leicht mit der Dauer, damit lange Drehungen nicht zu langsam kriechen
  const effectiveRotations = baseRotations + Math.floor(durationSec * 0.6);
  const totalDeltaAngle = effectiveRotations * Math.PI * 2 + randomFraction * Math.PI * 2;
  const startAngle = currentAngle;
  const startTime = performance.now();

  let lastSegmentIndex = getSegmentAtPointer(currentAngle)?.index ?? -1;

  // Musik starten
  startSpinMusic(durationSec);

  // Kubisches Ease-Out für realistisches Ausrollen des Glücksrads
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3.2);
  }

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    const eased = easeOutCubic(progress);

    currentAngle = startAngle + totalDeltaAngle * eased;
    drawWheel();

    // Prüfen, ob ein Segment-Übergang am Zeiger stattgefunden hat (für Zeiger-Wippen & optionales Klackern)
    const currentSeg = getSegmentAtPointer(currentAngle);
    if (currentSeg && currentSeg.index !== lastSegmentIndex) {
      lastSegmentIndex = currentSeg.index;
      triggerPointerBounce();
      playTickSound();
    }

    if (progress < 1) {
      spinAnimationFrame = requestAnimationFrame(animate);
    } else {
      finishSpin();
    }
  }

  spinAnimationFrame = requestAnimationFrame(animate);
}

function triggerPointerBounce() {
  wheelPointer.classList.add('tick-bounce');
  setTimeout(() => {
    wheelPointer.classList.remove('tick-bounce');
  }, 55);
}

function finishSpin() {
  isSpinning = false;
  spinBtn.disabled = false;
  stopSpinMusicImmediate();

  const winnerResult = getSegmentAtPointer(currentAngle);
  if (!winnerResult) return;

  lastWinnerEntry = winnerResult.entry;

  // In die Gewinner-Historie eintragen
  const winnerColor = lastWinnerEntry.color || getPaletteColor(winnerResult.index);
  state.history.unshift({
    id: generateId(),
    text: lastWinnerEntry.text,
    color: winnerColor,
    timestamp: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  });

  saveStateToStorage();
  renderHistory();

  // Gewinner-Sound & Konfetti & Modal
  playWinnerCelebrationSound();
  if (state.settings.enableConfetti) {
    launchConfetti();
  }
  showWinnerModal(lastWinnerEntry, winnerColor);
}

// --- Gewinner-Modal & Konfetti ---
const winnerModal = document.getElementById('winnerModal');
const winnerModalHeader = document.getElementById('winnerModalHeader');
const winnerTextDisplay = document.getElementById('winnerTextDisplay');
const winnerImagePreviewWrap = document.getElementById('winnerImagePreviewWrap');
const winnerImagePreview = document.getElementById('winnerImagePreview');

function showWinnerModal(entry, color) {
  winnerModalHeader.style.backgroundColor = color;
  winnerModalHeader.style.color = getContrastTextColor(color);
  winnerTextDisplay.textContent = entry.text;

  if (entry.image) {
    winnerImagePreview.src = entry.image;
    winnerImagePreviewWrap.classList.remove('hidden');
  } else {
    winnerImagePreviewWrap.classList.add('hidden');
  }

  winnerModal.classList.remove('hidden');
}

function closeWinnerModal() {
  winnerModal.classList.add('hidden');
  stopConfetti();
}

// --- Konfetti-Engine ---
const confettiCanvas = document.getElementById('confettiCanvas');
const confettiCtx = confettiCanvas.getContext('2d');
let confettiParticles = [];
let confettiAnimId = null;

function resizeConfettiCanvas() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeConfettiCanvas);
resizeConfettiCanvas();

function launchConfetti() {
  stopConfetti();
  const colors = ['#e52421', '#259b24', '#ef7d1a', '#3369e8', '#ffeb3b', '#9c27b0', '#00bcd4'];
  confettiParticles = Array.from({ length: 130 }, () => ({
    x: Math.random() * confettiCanvas.width,
    y: Math.random() * -confettiCanvas.height * 0.6 - 20,
    w: Math.random() * 10 + 6,
    h: Math.random() * 6 + 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    vy: Math.random() * 3.5 + 2.2,
    vx: (Math.random() - 0.5) * 2.5,
    angle: Math.random() * Math.PI * 2,
    vAngle: (Math.random() - 0.5) * 0.15
  }));

  function renderConfetti() {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    let activeCount = 0;

    confettiParticles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.vAngle;

      if (p.y < confettiCanvas.height + 30) {
        activeCount++;
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.angle);
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        confettiCtx.restore();
      }
    });

    if (activeCount > 0) {
      confettiAnimId = requestAnimationFrame(renderConfetti);
    } else {
      confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
  }

  confettiAnimId = requestAnimationFrame(renderConfetti);
}

function stopConfetti() {
  if (confettiAnimId) {
    cancelAnimationFrame(confettiAnimId);
    confettiAnimId = null;
  }
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

// --- Synchronisation zwischen Textarea, Erweitertem Modus & Rad ---
function syncUIFromState() {
  // 1. Textarea befüllen
  entriesTextarea.value = state.entries.map((e) => e.text).join('\n');

  // 2. Zähler-Badge aktualisieren ("Einträge: X")
  const activeCount = getActiveEntries().length;
  entriesCountPill.textContent = `Einträge: ${activeCount}`;

  // 3. Erweiterter Modus Ansicht
  if (state.settings.advancedMode) {
    simpleEditorContainer.classList.add('hidden');
    advancedEditorContainer.classList.remove('hidden');
    advancedModeBtn.classList.add('active');
    renderAdvancedEntriesList();
  } else {
    simpleEditorContainer.classList.remove('hidden');
    advancedEditorContainer.classList.add('hidden');
    advancedModeBtn.classList.remove('active');
  }

  // 4. Schnell-Status-Pills unter dem Rad aktualisieren
  document.getElementById('quickDurationText').textContent = `${state.settings.spinDuration} Sek.`;
  const songActiveText = state.settings.enableSpinMusic
    ? (customSpinAudioLoaded && state.settings.musicSourceType === 'custom' ? 'Eigener Song: An' : 'Musik: An')
    : 'Musik: Aus';
  document.getElementById('quickSongText').textContent = songActiveText;

  // 5. Einstellungs-Steuerelemente synchronisieren
  document.getElementById('spinDurationRange').value = Math.min(60, state.settings.spinDuration);
  document.getElementById('spinDurationNumber').value = state.settings.spinDuration;
  document.getElementById('spinPowerRange').value = state.settings.spinPower;
  updateSpinPowerLabel(state.settings.spinPower);

  document.getElementById('enableSpinMusicToggle').checked = state.settings.enableSpinMusic;
  document.getElementById('spinMusicControlsGroup').style.opacity = state.settings.enableSpinMusic ? '1' : '0.45';
  document.getElementById('musicSourceCustom').checked = state.settings.musicSourceType === 'custom';
  document.getElementById('musicSourceSynth').checked = state.settings.musicSourceType === 'synth';

  document.getElementById('songStartOffsetRange').value = state.settings.songStartOffset;
  document.getElementById('songStartOffsetNumber').value = state.settings.songStartOffset;
  document.getElementById('musicVolumeRange').value = state.settings.musicVolume;
  document.getElementById('musicVolumeLabel').textContent = `${state.settings.musicVolume}%`;
  document.getElementById('musicFadeOutToggle').checked = state.settings.musicFadeOut;
  document.getElementById('enableTickSoundToggle').checked = state.settings.enableTickSound;

  document.getElementById('enableWinnerSoundToggle').checked = state.settings.enableWinnerSound;
  document.getElementById('winnerSoundControlsGroup').style.opacity = state.settings.enableWinnerSound ? '1' : '0.45';
  document.getElementById('winnerVolumeRange').value = state.settings.winnerVolume;
  document.getElementById('winnerVolumeLabel').textContent = `${state.settings.winnerVolume}%`;

  document.getElementById('colorPaletteSelect').value = state.settings.colorPalette;
  document.getElementById('centerRadiusRange').value = state.settings.centerRadiusPct;
  document.getElementById('centerRadiusLabel').textContent = `${state.settings.centerRadiusPct}%`;
  document.getElementById('enableConfettiToggle').checked = state.settings.enableConfetti;

  // Dark Mode
  document.body.classList.toggle('dark-mode', !!state.settings.darkMode);
  document.getElementById('themeIconSun').classList.toggle('hidden', !state.settings.darkMode);
  document.getElementById('themeIconMoon').classList.toggle('hidden', !!state.settings.darkMode);

  preloadEntryImages();
  renderHistory();
  drawWheel();
}

function updateSpinPowerLabel(val) {
  const num = Number(val);
  let text = 'Mittel';
  if (num <= 5) text = 'Sanft';
  else if (num >= 14) text = 'Turbo';
  else if (num >= 10) text = 'Schnell';
  document.getElementById('spinPowerLabel').textContent = `${text} (${num}x)`;
}

// Wenn der Nutzer im einfachen Textfeld tippt, werden die Zeilen übernommen, bestehende Farben/Bilder bleiben erhalten
entriesTextarea.addEventListener('input', () => {
  const lines = entriesTextarea.value.split('\n');
  const updatedEntries = [];

  lines.forEach((lineText, idx) => {
    const existing = state.entries[idx];
    if (existing) {
      updatedEntries.push({
        ...existing,
        text: lineText
      });
    } else {
      updatedEntries.push({
        id: generateId(),
        text: lineText,
        color: getPaletteColor(idx),
        weight: 1,
        enabled: true,
        image: null
      });
    }
  });

  state.entries = updatedEntries;
  entriesCountPill.textContent = `Einträge: ${getActiveEntries().length}`;
  saveStateToStorage();
  drawWheel();
});

// Erweiterte Liste rendern (Farbe, Text, Bild, Gewichtung, Löschen pro Zeile)
function renderAdvancedEntriesList() {
  advancedEntriesList.innerHTML = '';

  state.entries.forEach((entry, idx) => {
    const row = document.createElement('div');
    row.className = 'adv-entry-row';

    // Checkbox (Ein/Aus)
    const toggleCb = document.createElement('input');
    toggleCb.type = 'checkbox';
    toggleCb.checked = entry.enabled !== false;
    toggleCb.title = 'Im Rad anzeigen';
    toggleCb.addEventListener('change', () => {
      entry.enabled = toggleCb.checked;
      saveStateToStorage();
      entriesCountPill.textContent = `Einträge: ${getActiveEntries().length}`;
      drawWheel();
    });

    // Farbwähler
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'adv-color-input';
    colorInput.value = entry.color || getPaletteColor(idx);
    colorInput.title = 'Segmentfarbe wählen';
    colorInput.addEventListener('input', () => {
      entry.color = colorInput.value;
      saveStateToStorage();
      drawWheel();
    });

    // Textfeld
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'adv-text-input';
    textInput.value = entry.text;
    textInput.placeholder = `Auswahl ${idx + 1}`;
    textInput.addEventListener('input', () => {
      entry.text = textInput.value;
      entriesTextarea.value = state.entries.map((e) => e.text).join('\n');
      entriesCountPill.textContent = `Einträge: ${getActiveEntries().length}`;
      saveStateToStorage();
      drawWheel();
    });

    // Bild-Vorschau oder Bild-Upload-Knopf
    const imgBtn = document.createElement('button');
    imgBtn.type = 'button';
    imgBtn.className = 'adv-icon-btn';
    imgBtn.title = entry.image ? 'Bild ändern / entfernen (Rechtsklick)' : 'Bild zu dieser Auswahl hinzufügen';
    imgBtn.textContent = entry.image ? '🖼️' : '📷';
    imgBtn.addEventListener('click', () => {
      triggerImageUploadForEntry(entry);
    });

    // Gewichtung
    const weightInput = document.createElement('input');
    weightInput.type = 'number';
    weightInput.min = '1';
    weightInput.max = '50';
    weightInput.className = 'adv-weight-input';
    weightInput.value = entry.weight || 1;
    weightInput.title = 'Gewichtung / relative Größe des Segments';
    weightInput.addEventListener('input', () => {
      entry.weight = Math.max(1, Number(weightInput.value) || 1);
      saveStateToStorage();
      drawWheel();
    });

    // Löschen
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'adv-icon-btn';
    delBtn.title = 'Eintrag löschen';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      state.entries.splice(idx, 1);
      saveStateToStorage();
      syncUIFromState();
    });

    row.append(toggleCb, colorInput, textInput, imgBtn, weightInput, delBtn);
    advancedEntriesList.appendChild(row);
  });
}

function triggerImageUploadForEntry(entry) {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    resizeAndLoadImage(file, (dataUrl) => {
      entry.image = dataUrl;
      preloadEntryImages();
      saveStateToStorage();
      syncUIFromState();
    });
  });
  fileInput.click();
}

function resizeAndLoadImage(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 160;
      let w = img.width;
      let h = img.height;
      if (w > h && w > maxDim) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else if (h > maxDim) {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// --- Gewinner-Historie rendern ---
function renderHistory() {
  historyCountBadge.textContent = state.history.length;
  restoreRemovedBtn.classList.toggle('hidden', state.removedEntries.length === 0);

  if (state.history.length === 0) {
    historyList.innerHTML = '<div class="empty-history">Noch keine Drehung durchgeführt. Drehe das Rad, um hier alle Gewinner zu sehen!</div>';
    return;
  }

  historyList.innerHTML = '';
  state.history.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'history-item';
    row.style.borderLeftColor = item.color || '#2563eb';

    const left = document.createElement('div');
    left.className = 'history-item-left';

    const rank = document.createElement('span');
    rank.className = 'history-rank';
    rank.textContent = `#${state.history.length - index}`;

    const name = document.createElement('span');
    name.className = 'history-winner-name';
    name.textContent = item.text;

    left.append(rank, name);

    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = item.timestamp || '';

    row.append(left, time);
    historyList.appendChild(row);
  });
}

// --- Event-Listener für Tabs, Toolbar & Einstellungen ---
function initEventListeners() {
  // Klick auf das Rad oder den Spin-Button oder Leertaste
  wheelWrapper.addEventListener('click', spinWheel);
  spinBtn.addEventListener('click', spinWheel);

  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (e.code === 'Space' && tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SELECT') {
      e.preventDefault();
      if (!winnerModal.classList.contains('hidden')) {
        closeWinnerModal();
      } else {
        spinWheel();
      }
    } else if (e.code === 'Escape' && !winnerModal.classList.contains('hidden')) {
      closeWinnerModal();
    }
  });

  // Tabs in der rechten Seitenleiste wechseln
  const tabButtons = document.querySelectorAll('.sidebar-tabs .tab-btn[data-tab]');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      switchSidebarTab(targetId);
    });
  });

  // Topbar "Einstellungen & Musik" Button öffnet den Einstellungs-Tab in der Seitenleiste
  document.getElementById('openSettingsBtn').addEventListener('click', () => {
    showSidebar();
    switchSidebarTab('settingsTab');
  });

  // Schnell-Pills unter dem Rad
  document.getElementById('quickDurationPill').addEventListener('click', () => {
    showSidebar();
    switchSidebarTab('settingsTab');
    document.getElementById('spinDurationNumber').focus();
  });

  document.getElementById('quickSongPill').addEventListener('click', () => {
    state.settings.enableSpinMusic = !state.settings.enableSpinMusic;
    saveStateToStorage();
    syncUIFromState();
  });

  // Seitenleiste ein-/ausblenden (Auge-Icon wie in Screenshot 2)
  document.getElementById('hideSidebarBtn').addEventListener('click', () => {
    document.getElementById('sidebarPanel').classList.add('hidden');
    document.getElementById('mainLayout').classList.add('sidebar-hidden');
    document.getElementById('showSidebarFloatingBtn').classList.remove('hidden');
  });

  document.getElementById('showSidebarFloatingBtn').addEventListener('click', showSidebar);

  // Hell-/Dunkelmodus
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    state.settings.darkMode = !state.settings.darkMode;
    saveStateToStorage();
    syncUIFromState();
  });

  // Mischen (Shuffle)
  document.getElementById('shuffleBtn').addEventListener('click', () => {
    for (let i = state.entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.entries[i], state.entries[j]] = [state.entries[j], state.entries[i]];
    }
    saveStateToStorage();
    syncUIFromState();
  });

  // Alphabetisch sortieren (A-Z / Z-A)
  document.getElementById('sortBtn').addEventListener('click', () => {
    state.entries.sort((a, b) => {
      const cmp = a.text.localeCompare(b.text, 'de', { sensitivity: 'base' });
      return sortAscending ? cmp : -cmp;
    });
    sortAscending = !sortAscending;
    saveStateToStorage();
    syncUIFromState();
  });

  // Erweiterter Modus umschalten
  advancedModeBtn.addEventListener('click', () => {
    state.settings.advancedMode = !state.settings.advancedMode;
    saveStateToStorage();
    syncUIFromState();
  });

  document.getElementById('addAdvancedRowBtn').addEventListener('click', () => {
    const idx = state.entries.length;
    state.entries.push({
      id: generateId(),
      text: `Auswahl ${idx + 1}`,
      color: getPaletteColor(idx),
      weight: 1,
      enabled: true,
      image: null
    });
    saveStateToStorage();
    syncUIFromState();
  });

  // "Bild hinzufügen" Button in der Toolbar -> Fügt eine neue Option mit Bild hinzu
  const segmentImageInput = document.getElementById('segmentImageInput');
  document.getElementById('addImageEntryBtn').addEventListener('click', () => {
    segmentImageInput.click();
  });

  segmentImageInput.addEventListener('change', () => {
    const file = segmentImageInput.files[0];
    if (!file) return;
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    resizeAndLoadImage(file, (dataUrl) => {
      const idx = state.entries.length;
      state.entries.push({
        id: generateId(),
        text: baseName || `Bild ${idx + 1}`,
        color: getPaletteColor(idx),
        weight: 1,
        enabled: true,
        image: dataUrl
      });
      preloadEntryImages();
      saveStateToStorage();
      syncUIFromState();
    });
    segmentImageInput.value = '';
  });

  // Auf Standard zurücksetzen
  document.getElementById('resetDefaultEntriesBtn').addEventListener('click', () => {
    state.entries = structuredClone(DEFAULT_STATE.entries);
    state.removedEntries = [];
    saveStateToStorage();
    syncUIFromState();
  });

  // Emoji-Picker initialisieren
  const emojiGrid = document.getElementById('emojiGrid');
  const emojiPopover = document.getElementById('emojiPopover');
  POPULAR_EMOJIS.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emoji-item-btn';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      insertEmojiIntoTextarea(emoji);
      emojiPopover.classList.add('hidden');
    });
    emojiGrid.appendChild(btn);
  });

  document.getElementById('emojiToggleBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPopover.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    emojiPopover.classList.add('hidden');
  });

  // Historie Aktionen
  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    state.history = [];
    saveStateToStorage();
    renderHistory();
  });

  restoreRemovedBtn.addEventListener('click', () => {
    if (state.removedEntries.length > 0) {
      state.entries.push(...state.removedEntries);
      state.removedEntries = [];
      saveStateToStorage();
      syncUIFromState();
    }
  });

  // Gewinner-Modal Buttons
  document.getElementById('closeWinnerBtn').addEventListener('click', closeWinnerModal);
  document.getElementById('closeWinnerModalX').addEventListener('click', closeWinnerModal);
  winnerModal.addEventListener('click', (e) => {
    if (e.target === winnerModal) closeWinnerModal();
  });

  document.getElementById('removeWinnerBtn').addEventListener('click', () => {
    if (lastWinnerEntry) {
      const idx = state.entries.findIndex((e) => e.id === lastWinnerEntry.id);
      if (idx !== -1) {
        const [removed] = state.entries.splice(idx, 1);
        state.removedEntries.push(removed);
        saveStateToStorage();
        syncUIFromState();
      }
    }
    closeWinnerModal();
  });

  // --- Einstellungen: Drehzeit & Dynamik ---
  const spinDurationRange = document.getElementById('spinDurationRange');
  const spinDurationNumber = document.getElementById('spinDurationNumber');

  spinDurationRange.addEventListener('input', () => {
    state.settings.spinDuration = Number(spinDurationRange.value);
    spinDurationNumber.value = state.settings.spinDuration;
    document.getElementById('quickDurationText').textContent = `${state.settings.spinDuration} Sek.`;
    saveStateToStorage();
  });

  spinDurationNumber.addEventListener('input', () => {
    const val = Math.max(1, Math.min(120, Number(spinDurationNumber.value) || 8));
    state.settings.spinDuration = val;
    spinDurationRange.value = Math.min(60, val);
    document.getElementById('quickDurationText').textContent = `${val} Sek.`;
    saveStateToStorage();
  });

  const spinPowerRange = document.getElementById('spinPowerRange');
  spinPowerRange.addEventListener('input', () => {
    state.settings.spinPower = Number(spinPowerRange.value);
    updateSpinPowerLabel(state.settings.spinPower);
    saveStateToStorage();
  });

  // --- Einstellungen: Musik während der Drehung ---
  document.getElementById('enableSpinMusicToggle').addEventListener('change', (e) => {
    state.settings.enableSpinMusic = e.target.checked;
    if (!state.settings.enableSpinMusic) stopSpinMusicImmediate();
    saveStateToStorage();
    syncUIFromState();
  });

  document.querySelectorAll('input[name="musicSourceType"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      state.settings.musicSourceType = e.target.value;
      saveStateToStorage();
      syncUIFromState();
    });
  });

  // Eigene Audiodatei hochladen
  const songFileInput = document.getElementById('songFileInput');
  songFileInput.addEventListener('change', () => {
    const file = songFileInput.files[0];
    if (!file) return;
    loadCustomSpinSongBlob(file, file.name, true);
    state.settings.musicSourceType = 'custom';
    saveStateToStorage();
    syncUIFromState();
  });

  document.getElementById('removeSongBtn').addEventListener('click', () => {
    stopSpinMusicImmediate();
    customSpinAudio.src = '';
    customSpinAudioLoaded = false;
    customSpinAudioName = '';
    deleteAudioFromDB('spinSong');
    updateCustomSongInfoUI();
    syncUIFromState();
  });

  // Startpunkt im Song (Slider + Zahleneingabe)
  const songStartOffsetRange = document.getElementById('songStartOffsetRange');
  const songStartOffsetNumber = document.getElementById('songStartOffsetNumber');

  songStartOffsetRange.addEventListener('input', () => {
    state.settings.songStartOffset = Number(songStartOffsetRange.value);
    songStartOffsetNumber.value = state.settings.songStartOffset;
    saveStateToStorage();
  });

  songStartOffsetNumber.addEventListener('input', () => {
    const val = Math.max(0, Number(songStartOffsetNumber.value) || 0);
    state.settings.songStartOffset = val;
    songStartOffsetRange.value = Math.min(Number(songStartOffsetRange.max) || 180, val);
    saveStateToStorage();
  });

  // Song ab Startpunkt vorhören (Preview)
  document.getElementById('previewSongBtn').addEventListener('click', () => {
    if (isPreviewPlaying) {
      stopSpinMusicImmediate();
      return;
    }
    if (customSpinAudioLoaded) {
      isPreviewPlaying = true;
      updatePreviewButtonUI();
      customSpinAudio.currentTime = Math.min(
        Number(state.settings.songStartOffset) || 0,
        Math.max(0, (customSpinAudio.duration || 0) - 0.5)
      );
      customSpinAudio.volume = state.settings.musicVolume / 100;
      customSpinAudio.play().catch(() => {});
      previewTimeout = setTimeout(() => {
        stopSpinMusicImmediate();
      }, 6000);
    } else {
      // Kurze Vorschau der integrierten Melodie
      isPreviewPlaying = true;
      updatePreviewButtonUI();
      isSpinning = true;
      startSynthSpinMelody();
      previewTimeout = setTimeout(() => {
        isSpinning = false;
        stopSpinMusicImmediate();
      }, 3000);
    }
  });

  // Musik-Lautstärke
  const musicVolumeRange = document.getElementById('musicVolumeRange');
  musicVolumeRange.addEventListener('input', () => {
    state.settings.musicVolume = Number(musicVolumeRange.value);
    document.getElementById('musicVolumeLabel').textContent = `${state.settings.musicVolume}%`;
    if (customSpinAudioLoaded) {
      customSpinAudio.volume = state.settings.musicVolume / 100;
    }
    saveStateToStorage();
  });

  document.getElementById('musicFadeOutToggle').addEventListener('change', (e) => {
    state.settings.musicFadeOut = e.target.checked;
    saveStateToStorage();
  });

  document.getElementById('enableTickSoundToggle').addEventListener('change', (e) => {
    state.settings.enableTickSound = e.target.checked;
    saveStateToStorage();
  });

  // --- Einstellungen: Gewinner-Sound ---
  document.getElementById('enableWinnerSoundToggle').addEventListener('change', (e) => {
    state.settings.enableWinnerSound = e.target.checked;
    saveStateToStorage();
    syncUIFromState();
  });

  const winnerVolumeRange = document.getElementById('winnerVolumeRange');
  winnerVolumeRange.addEventListener('input', () => {
    state.settings.winnerVolume = Number(winnerVolumeRange.value);
    document.getElementById('winnerVolumeLabel').textContent = `${state.settings.winnerVolume}%`;
    saveStateToStorage();
  });

  const winnerSoundFileInput = document.getElementById('winnerSoundFileInput');
  winnerSoundFileInput.addEventListener('change', () => {
    const file = winnerSoundFileInput.files[0];
    if (!file) return;
    loadCustomWinnerSoundBlob(file, file.name, true);
  });

  document.getElementById('removeWinnerSoundBtn').addEventListener('click', () => {
    customWinnerAudio.pause();
    customWinnerAudio.src = '';
    customWinnerAudioLoaded = false;
    customWinnerAudioName = '';
    deleteAudioFromDB('winnerSound');
    updateWinnerSoundInfoUI();
  });

  document.getElementById('testWinnerSoundBtn').addEventListener('click', () => {
    playWinnerCelebrationSound();
  });

  // --- Einstellungen: Design & Farbschema ---
  document.getElementById('colorPaletteSelect').addEventListener('change', (e) => {
    state.settings.colorPalette = e.target.value;
    // Allen Einträgen die neue Palette zuweisen
    state.entries.forEach((entry, idx) => {
      entry.color = getPaletteColor(idx);
    });
    saveStateToStorage();
    syncUIFromState();
  });

  const centerRadiusRange = document.getElementById('centerRadiusRange');
  centerRadiusRange.addEventListener('input', () => {
    state.settings.centerRadiusPct = Number(centerRadiusRange.value);
    document.getElementById('centerRadiusLabel').textContent = `${state.settings.centerRadiusPct}%`;
    saveStateToStorage();
    drawWheel();
  });

  document.getElementById('enableConfettiToggle').addEventListener('change', (e) => {
    state.settings.enableConfetti = e.target.checked;
    saveStateToStorage();
  });
}

function switchSidebarTab(tabId) {
  document.querySelectorAll('.sidebar-tabs .tab-btn[data-tab]').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-content').forEach((content) => {
    content.classList.toggle('active', content.id === tabId);
  });
}

function showSidebar() {
  document.getElementById('sidebarPanel').classList.remove('hidden');
  document.getElementById('mainLayout').classList.remove('sidebar-hidden');
  document.getElementById('showSidebarFloatingBtn').classList.add('hidden');
}

function insertEmojiIntoTextarea(emoji) {
  const start = entriesTextarea.selectionStart;
  const end = entriesTextarea.selectionEnd;
  const text = entriesTextarea.value;
  entriesTextarea.value = text.substring(0, start) + emoji + text.substring(end);
  entriesTextarea.selectionStart = entriesTextarea.selectionEnd = start + emoji.length;
  entriesTextarea.focus();
  entriesTextarea.dispatchEvent(new Event('input'));
}

// --- Audio-Datei Laden & UI-Aktualisierung ---
function loadCustomSpinSongBlob(blob, fileName, persistToDB = false) {
  const url = URL.createObjectURL(blob);
  customSpinAudio.src = url;
  customSpinAudioLoaded = true;
  customSpinAudioName = fileName;

  customSpinAudio.onloadedmetadata = () => {
    const dur = Math.floor(customSpinAudio.duration || 0);
    const offsetSlider = document.getElementById('songStartOffsetRange');
    if (dur > 0) {
      offsetSlider.max = Math.max(10, dur - 1);
      const mins = Math.floor(dur / 60);
      const secs = String(dur % 60).padStart(2, '0');
      document.getElementById('songDurationHint').textContent = `Länge: ${mins}:${secs} Min.`;
    }
  };

  if (persistToDB) {
    saveAudioToDB('spinSong', blob, fileName);
  }
  updateCustomSongInfoUI();
}

function updateCustomSongInfoUI() {
  const nameSpan = document.getElementById('songFileName');
  const removeBtn = document.getElementById('removeSongBtn');
  if (customSpinAudioLoaded) {
    nameSpan.textContent = `🎵 ${customSpinAudioName}`;
    removeBtn.classList.remove('hidden');
  } else {
    nameSpan.textContent = 'Noch kein eigener Song gewählt (nutzt Melodie bis zum Upload)';
    removeBtn.classList.add('hidden');
    document.getElementById('songDurationHint').textContent = '';
  }
}

function updatePreviewButtonUI() {
  const btn = document.getElementById('previewSongBtn');
  btn.textContent = isPreviewPlaying ? '⏹️ Vorschau stoppen' : '▶️ Ab Startpunkt vorhören';
}

function loadCustomWinnerSoundBlob(blob, fileName, persistToDB = false) {
  const url = URL.createObjectURL(blob);
  customWinnerAudio.src = url;
  customWinnerAudioLoaded = true;
  customWinnerAudioName = fileName;
  if (persistToDB) {
    saveAudioToDB('winnerSound', blob, fileName);
  }
  updateWinnerSoundInfoUI();
}

function updateWinnerSoundInfoUI() {
  const nameSpan = document.getElementById('winnerSoundFileName');
  const removeBtn = document.getElementById('removeWinnerSoundBtn');
  if (customWinnerAudioLoaded) {
    nameSpan.textContent = `🔊 ${customWinnerAudioName}`;
    removeBtn.classList.remove('hidden');
  } else {
    nameSpan.textContent = 'Standard: Feier-Fanfare & Jubel';
    removeBtn.classList.add('hidden');
  }
}

// Gespeicherte Audiodateien beim Start aus IndexedDB wiederherstellen
async function restoreSavedAudioFiles() {
  const savedSpinSong = await loadAudioFromDB('spinSong');
  if (savedSpinSong && savedSpinSong.blob) {
    loadCustomSpinSongBlob(savedSpinSong.blob, savedSpinSong.name, false);
  }
  const savedWinnerSound = await loadAudioFromDB('winnerSound');
  if (savedWinnerSound && savedWinnerSound.blob) {
    loadCustomWinnerSoundBlob(savedWinnerSound.blob, savedWinnerSound.name, false);
  }
  syncUIFromState();
}

// --- Initialisierung ---
initEventListeners();
syncUIFromState();
restoreSavedAudioFiles();
