import './style.css';
import { Tuner } from './pitch.js';
import {
  amplitudeToDb,
  centsBetween,
  dbToAmplitude,
  nearestString,
  noteFromFrequency,
  stringNumber,
  STRING_COUNT,
} from './tuning.js';
import {
  DEFAULT_SENSITIVITY_DB,
  MAX_HZ,
  MIN_HZ,
  SENSITIVITY_MAX_DB,
  SENSITIVITY_MIN_DB,
  validatePreset,
} from './presets-shared.js';
import * as api from './api.js';
import { mountIcons } from './icons.js';
import { playReference, stopReference } from './reference.js';
import { keepScreenAwake } from './wakelock.js';

const IN_TUNE_CENTS = 3; // margen para considerar la cuerda afinada
const HOLD_MS = 600; // tiempo afinada antes de marcarla con ✓
const SIGNAL_TIMEOUT_MS = 1500; // sin sonido por este tiempo → estado de espera
const GAUGE_RANGE_CENTS = 50;
const GAUGE_ANGLE = 60; // grados a cada lado del centro
const SMOOTHING = 0.3;
const REFERENCE_TAIL_MS = 400; // se ignora el micrófono un momento tras el tono (eco de la sala)

const $ = (id) => document.getElementById(id);
const els = {
  presetSelect: $('preset-select'),
  editPreset: $('edit-preset'),
  newPreset: $('new-preset'),
  appError: $('app-error'),
  appErrorText: $('app-error-text'),
  needle: $('needle'),
  gaugeTicks: $('gauge-ticks'),
  gaugeZone: $('gauge-zone'),
  meter: document.querySelector('.meter'),
  noteRing: $('note-ring'),
  targetNote: $('target-note'),
  targetString: $('target-string'),
  status: $('status'),
  detectedHz: $('detected-hz'),
  detectedNote: $('detected-note'),
  targetHz: $('target-hz'),
  playRef: $('play-ref'),
  signal: $('signal'),
  sensitivity: $('sensitivity'),
  cents: $('cents'),
  modeLabel: $('mode-label'),
  modeChip: $('mode-chip'),
  strings: $('strings'),
  restoreDefaults: $('restore-defaults'),
  overlay: $('start-overlay'),
  startBtn: $('start-btn'),
  startError: $('start-error'),
  editor: $('editor'),
  editorForm: $('editor-form'),
  editorTitle: $('editor-title'),
  presetName: $('preset-name'),
  editorStrings: $('editor-strings'),
  editorError: $('editor-error'),
  deletePreset: $('delete-preset'),
  cancelEdit: $('cancel-edit'),
};

const state = {
  presets: [],
  activeId: null,
  lockedIndex: null, // cuerda fijada manualmente (null = detección automática)
  detectedIndex: null,
  displayCents: 0,
  lastSignalAt: 0,
  idle: true,
  inTuneSince: null,
  tuned: new Set(),
  editingId: null, // null = creando una nueva
  sensitivityDb: DEFAULT_SENSITIVITY_DB,
  referencePlaying: false,
  ignoreUntil: 0, // hasta cuándo ignorar el micrófono tras el tono de referencia
};

let tuner = null;

const activePreset = () => state.presets.find((p) => p.id === state.activeId) ?? state.presets[0];

// ---------- Errores ----------

function showError(message) {
  els.appErrorText.textContent = message;
  els.appError.hidden = false;
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => (els.appError.hidden = true), 6000);
}

// ---------- Medidor ----------

function pointOnArc(angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  return [150 + radius * Math.sin(rad), 150 - radius * Math.cos(rad)];
}

const centsToAngle = (cents) =>
  (Math.max(-GAUGE_RANGE_CENTS, Math.min(GAUGE_RANGE_CENTS, cents)) / GAUGE_RANGE_CENTS) * GAUGE_ANGLE;

function buildGauge() {
  const ns = 'http://www.w3.org/2000/svg';
  for (let c = -GAUGE_RANGE_CENTS; c <= GAUGE_RANGE_CENTS; c += 5) {
    const major = c % 25 === 0;
    const angle = centsToAngle(c);
    const [x1, y1] = pointOnArc(angle, 120);
    const [x2, y2] = pointOnArc(angle, major ? 100 : 110);
    const line = document.createElementNS(ns, 'line');
    Object.entries({ x1, y1, x2, y2, class: major ? 'tick major' : 'tick' }).forEach(([k, v]) => line.setAttribute(k, v));
    els.gaugeTicks.append(line);
    if (major) {
      const [tx, ty] = pointOnArc(angle, 86);
      const label = document.createElementNS(ns, 'text');
      Object.entries({ x: tx, y: ty + 4, class: 'tick-label' }).forEach(([k, v]) => label.setAttribute(k, v));
      label.textContent = c > 0 ? `+${c}` : `${c}`;
      els.gaugeTicks.append(label);
    }
  }
  const [zx1, zy1] = pointOnArc(centsToAngle(-IN_TUNE_CENTS), 120);
  const [zx2, zy2] = pointOnArc(centsToAngle(IN_TUNE_CENTS), 120);
  els.gaugeZone.setAttribute('d', `M ${zx1} ${zy1} A 120 120 0 0 1 ${zx2} ${zy2}`);
}

function setNeedle(cents) {
  els.needle.style.transform = `rotate(${centsToAngle(cents)}deg)`;
}

function showIdle() {
  if (state.idle) return;
  state.idle = true;
  state.detectedIndex = null;
  state.inTuneSince = null;
  state.displayCents = 0;
  setNeedle(0);
  els.meter.className = 'meter idle';
  els.status.textContent = 'Esperando sonido…';
  els.detectedHz.textContent = '—';
  els.detectedNote.textContent = '';
  els.cents.textContent = '—';
  renderTarget();
  highlightStrings();
}

function onReading(freq, level) {
  updateSignal(level);
  const now = performance.now();
  // Mientras suena el tono de referencia el micrófono lo escucha: no se evalúa.
  if (state.referencePlaying || now < state.ignoreUntil) return;
  if (freq == null) {
    if (now - state.lastSignalAt > SIGNAL_TIMEOUT_MS) showIdle();
    return;
  }
  state.lastSignalAt = now;
  state.idle = false;

  const preset = activePreset();
  const { index, cents } =
    state.lockedIndex !== null
      ? { index: state.lockedIndex, cents: centsBetween(freq, preset.strings[state.lockedIndex]) }
      : nearestString(freq, preset.strings);

  if (index !== state.detectedIndex) {
    state.detectedIndex = index;
    state.displayCents = cents;
    state.inTuneSince = null;
    renderTarget();
    highlightStrings();
  } else {
    state.displayCents += (cents - state.displayCents) * SMOOTHING;
  }

  const shown = state.displayCents;
  const inTune = Math.abs(shown) <= IN_TUNE_CENTS;
  setNeedle(shown);

  els.meter.className = `meter ${inTune ? 'in-tune' : shown < 0 ? 'flat' : 'sharp'}`;
  els.status.textContent = inTune ? '¡Afinada!' : shown < 0 ? 'Baja · sube la tensión ↑' : 'Alta · baja la tensión ↓';
  const detected = noteFromFrequency(freq);
  els.detectedHz.textContent = `${freq.toFixed(2)} Hz`;
  els.detectedNote.textContent = detected.label;
  els.cents.textContent = `${shown > 0 ? '+' : ''}${shown.toFixed(1)} ¢`;

  if (inTune) {
    state.inTuneSince ??= now;
    if (now - state.inTuneSince >= HOLD_MS && !state.tuned.has(index)) {
      state.tuned.add(index);
      highlightStrings();
    }
  } else {
    state.inTuneSince = null;
  }
}

function renderTarget() {
  const index = state.lockedIndex ?? state.detectedIndex;
  if (index == null) {
    els.targetNote.textContent = '';
    els.targetString.textContent = '';
    els.targetHz.textContent = '—';
    els.noteRing.classList.add('empty');
    els.playRef.disabled = true;
    return;
  }
  const hz = activePreset().strings[index];
  els.targetNote.textContent = noteFromFrequency(hz).label;
  els.targetString.textContent = stringNumber(index);
  els.targetHz.textContent = `${hz.toFixed(2)} Hz`;
  els.noteRing.classList.remove('empty');
  els.playRef.disabled = false;
}

// ---------- Tono de referencia ----------

function toggleReference() {
  if (state.referencePlaying) return endReference(true);
  const index = state.lockedIndex ?? state.detectedIndex;
  if (index == null) return;
  state.referencePlaying = true;
  els.meter.classList.add('playing');
  els.playRef.classList.add('playing');
  els.playRef.setAttribute('aria-pressed', 'true');
  playReference(activePreset().strings[index], () => endReference(false));
}

function endReference(stop) {
  if (!state.referencePlaying) return;
  if (stop) stopReference();
  state.referencePlaying = false;
  state.ignoreUntil = performance.now() + REFERENCE_TAIL_MS;
  state.lastSignalAt = performance.now();
  els.meter.classList.remove('playing');
  els.playRef.classList.remove('playing');
  els.playRef.setAttribute('aria-pressed', 'false');
}

// ---------- Señal y sensibilidad ----------

const SENSITIVITY_SPAN_DB = SENSITIVITY_MAX_DB - SENSITIVITY_MIN_DB;

function updateSignal(level) {
  const db = Math.max(SENSITIVITY_MIN_DB, Math.min(SENSITIVITY_MAX_DB, amplitudeToDb(level)));
  els.sensitivity.style.setProperty('--level', `${((db - SENSITIVITY_MIN_DB) / SENSITIVITY_SPAN_DB) * 100}%`);
  els.signal.classList.toggle('passing', level >= dbToAmplitude(state.sensitivityDb));
}

function applySensitivity(db) {
  state.sensitivityDb = db;
  els.sensitivity.value = db;
  if (tuner) tuner.minRms = dbToAmplitude(db);
}

async function saveSensitivity() {
  try {
    await api.updateSettings({ sensitivityDb: state.sensitivityDb });
  } catch (err) {
    showError(`No se pudo guardar la sensibilidad: ${err.message}`);
  }
}

// ---------- Cuerdas ----------

function renderStrings() {
  const preset = activePreset();
  els.strings.replaceChildren(
    ...preset.strings.map((hz, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'string-btn';
      btn.dataset.index = i;
      btn.style.setProperty('--gauge', `${1 + (STRING_COUNT - 1 - i) * 0.5}px`);
      btn.title = `${stringNumber(i)}ª cuerda`;
      btn.setAttribute('aria-label', `${stringNumber(i)}ª cuerda, ${noteFromFrequency(hz).label}`);
      btn.innerHTML = `
        <span class="string-line" aria-hidden="true"></span>
        <span data-icon="Lock" class="string-lock"></span>
        <span data-icon="CircleCheck" class="string-check"></span>
        <span class="string-num">${stringNumber(i)}</span>
        <span class="string-note">${noteFromFrequency(hz).label}</span>
        <span class="string-hz">${hz.toFixed(2)}</span>`;
      mountIcons(btn);
      btn.addEventListener('click', () => toggleLock(i));
      return btn;
    }),
  );
  highlightStrings();
}

function highlightStrings() {
  els.strings.querySelectorAll('.string-btn').forEach((btn) => {
    const i = Number(btn.dataset.index);
    btn.classList.toggle('detected', i === state.detectedIndex && !state.idle);
    btn.classList.toggle('locked', i === state.lockedIndex);
    btn.classList.toggle('tuned', state.tuned.has(i));
    btn.setAttribute('aria-pressed', String(i === state.lockedIndex));
  });
  const locked = state.lockedIndex !== null;
  els.modeLabel.textContent = locked ? `${stringNumber(state.lockedIndex)}ª` : 'Auto';
  els.modeChip.classList.toggle('manual', locked);
  els.modeChip.disabled = !locked;
  els.modeChip.title = locked ? 'Volver a detección automática' : 'Detección automática';
}

function toggleLock(index) {
  endReference(true);
  state.lockedIndex = state.lockedIndex === index ? null : index;
  state.detectedIndex = null;
  state.inTuneSince = null;
  renderTarget();
  highlightStrings();
}

// ---------- Afinaciones ----------

function renderPresetSelect() {
  els.presetSelect.replaceChildren(
    ...state.presets.map((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      return opt;
    }),
  );
  els.presetSelect.value = activePreset()?.id ?? '';
}

function applySnapshot({ presets, activeId }) {
  state.presets = presets;
  state.activeId = activeId;
  resetTuningSession();
  renderPresetSelect();
  renderStrings();
}

function resetTuningSession() {
  endReference(true);
  state.lockedIndex = null;
  state.detectedIndex = null;
  state.inTuneSince = null;
  state.tuned.clear();
  renderTarget();
}

async function selectPreset(id) {
  state.activeId = id;
  resetTuningSession();
  renderStrings();
  try {
    await api.setActivePreset(id);
  } catch (err) {
    showError(`No se pudo guardar la afinación activa: ${err.message}`);
  }
}

async function reloadPresets() {
  applySnapshot(await api.fetchPresets());
}

// ---------- Editor ----------

function openEditor(preset) {
  state.editingId = preset?.id ?? null;
  const base = preset ?? activePreset();
  els.editorTitle.textContent = preset ? 'Editar afinación' : 'Nueva afinación';
  els.presetName.value = preset ? preset.name : '';
  els.editorError.hidden = true;
  els.deletePreset.hidden = !preset || state.presets.length <= 1;

  els.editorStrings.replaceChildren(
    ...base.strings.map((hz, i) => {
      const row = document.createElement('label');
      row.className = 'editor-row';
      row.style.setProperty('--gauge', `${1 + (STRING_COUNT - 1 - i) * 0.5}px`);
      row.innerHTML = `
        <span class="editor-label" title="${stringNumber(i)}ª cuerda">
          <span class="string-num">${stringNumber(i)}</span>
          <span class="string-line" aria-hidden="true"></span>
        </span>
        <input type="number" inputmode="decimal" step="0.01" min="${MIN_HZ}" max="${MAX_HZ}" required aria-label="${stringNumber(i)}ª cuerda en Hz" />
        <span class="editor-unit">Hz</span>
        <span class="editor-note"></span>`;
      const input = row.querySelector('input');
      const note = row.querySelector('.editor-note');
      const updateNote = () => {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < MIN_HZ || value > MAX_HZ) {
          note.textContent = '—';
          return;
        }
        const n = noteFromFrequency(value);
        const c = Math.round(n.cents);
        note.textContent = c === 0 ? n.label : `${n.label} ${c > 0 ? '+' : ''}${c}¢`;
      };
      input.value = hz;
      input.addEventListener('input', updateNote);
      updateNote();
      return row;
    }),
  );
  els.editor.showModal();
  els.presetName.focus();
}

async function saveEditor(event) {
  event.preventDefault();
  const inputs = [...els.editorStrings.querySelectorAll('input')];
  const { value, error } = validatePreset({
    name: els.presetName.value,
    strings: inputs.map((input) => (input.value === '' ? NaN : Number(input.value))),
  });
  if (error) {
    els.editorError.textContent = error;
    els.editorError.hidden = false;
    return;
  }
  try {
    const saved = state.editingId
      ? await api.updatePreset(state.editingId, value)
      : await api.createPreset(value);
    await api.setActivePreset(saved.id);
    await reloadPresets();
    els.editor.close();
  } catch (err) {
    els.editorError.textContent = err.message;
    els.editorError.hidden = false;
  }
}

async function deleteEditing() {
  const preset = state.presets.find((p) => p.id === state.editingId);
  if (!preset || !confirm(`¿Eliminar la afinación "${preset.name}"?`)) return;
  try {
    await api.deletePreset(preset.id);
    await reloadPresets();
    els.editor.close();
  } catch (err) {
    els.editorError.textContent = err.message;
    els.editorError.hidden = false;
  }
}

async function restoreDefaults() {
  if (!confirm('Las afinaciones predefinidas volverán a sus valores originales. Tus afinaciones personalizadas se mantienen. ¿Continuar?')) return;
  try {
    applySnapshot(await api.restoreDefaults());
  } catch (err) {
    showError(`No se pudieron restaurar: ${err.message}`);
  }
}

// ---------- Micrófono ----------

async function startTuner() {
  els.startError.hidden = true;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    els.startError.textContent = 'El micrófono solo está disponible en localhost o con HTTPS.';
    els.startError.hidden = false;
    return;
  }
  els.startBtn.disabled = true;
  try {
    tuner = new Tuner(onReading);
    tuner.minRms = dbToAmplitude(state.sensitivityDb);
    await tuner.start();
    keepScreenAwake();
    els.overlay.hidden = true;
  } catch (err) {
    els.startError.textContent =
      err.name === 'NotAllowedError'
        ? 'Permiso de micrófono denegado. Habilítalo en la configuración del navegador y vuelve a intentar.'
        : `No se pudo iniciar el micrófono: ${err.message}`;
    els.startError.hidden = false;
  } finally {
    els.startBtn.disabled = false;
  }
}

// ---------- Inicio ----------

function bindEvents() {
  els.presetSelect.addEventListener('change', () => selectPreset(els.presetSelect.value));
  els.editPreset.addEventListener('click', () => openEditor(activePreset()));
  els.newPreset.addEventListener('click', () => openEditor(null));
  els.modeChip.addEventListener('click', () => toggleLock(state.lockedIndex));
  els.restoreDefaults.addEventListener('click', restoreDefaults);
  els.startBtn.addEventListener('click', startTuner);
  els.editorForm.addEventListener('submit', saveEditor);
  els.cancelEdit.addEventListener('click', () => els.editor.close());
  els.deletePreset.addEventListener('click', deleteEditing);
  els.playRef.addEventListener('click', toggleReference);
  els.sensitivity.addEventListener('input', () => applySensitivity(Number(els.sensitivity.value)));
  els.sensitivity.addEventListener('change', saveSensitivity);
}

async function init() {
  mountIcons();
  buildGauge();
  bindEvents();
  els.sensitivity.min = SENSITIVITY_MIN_DB;
  els.sensitivity.max = SENSITIVITY_MAX_DB;
  applySensitivity(DEFAULT_SENSITIVITY_DB);
  const [presets, settings] = await Promise.allSettled([reloadPresets(), api.fetchSettings()]);
  if (presets.status === 'rejected') showError(`No se pudieron cargar las afinaciones: ${presets.reason.message}`);
  if (settings.status === 'fulfilled') applySensitivity(settings.value.sensitivityDb);
  else showError(`No se pudo cargar la sensibilidad: ${settings.reason.message}`);
}

init();
