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
import { icon, mountIcons } from './icons.js';
import { chime, playReference, stopReference } from './reference.js';
import { createTabView } from './tab-view.js';
import { canAutofocus, createToast, setupSheet, tuningNotes } from './ui.js';
import { keepScreenAwake } from './wakelock.js';

const IN_TUNE_CENTS = 3; // margen para considerar la cuerda afinada
const HOLD_MS = 600; // tiempo afinada antes de marcarla con ✓
const SIGNAL_TIMEOUT_MS = 1500; // sin sonido por este tiempo → estado de espera
const GAUGE_RANGE_CENTS = 50;
const GAUGE_ANGLE = 60; // grados a cada lado del centro
const FAR_CENTS = 100; // desde aquí se muestra la nota que suena en vez de los cents
const SMOOTHING = 0.3;
const REFERENCE_TAIL_MS = 400; // se ignora el micrófono un momento tras el tono (eco de la sala)
const COMPLETE_HOLD_MS = 2500; // "Guitarra afinada" se mantiene al menos este tiempo

const $ = (id) => document.getElementById(id);
const els = {
  tuningBtn: $('tuning-btn'),
  tuningName: $('tuning-name'),
  tuningNotes: $('tuning-notes'),
  settingsBtn: $('settings-btn'),
  needle: $('needle'),
  gaugeTicks: $('gauge-ticks'),
  gaugeZone: $('gauge-zone'),
  meter: document.querySelector('.meter'),
  noteRing: $('note-ring'),
  targetNote: $('target-note'),
  targetString: $('target-string'),
  startBtn: $('start-btn'),
  statusWord: $('status-word'),
  statusDetail: $('status-detail'),
  status: $('status'),
  stringsHint: $('strings-hint'),
  modeChip: $('mode-chip'),
  modeLabel: $('mode-label'),
  strings: $('strings'),
  tuningSheet: $('tuning-sheet'),
  tuningList: $('tuning-list'),
  newPreset: $('new-preset'),
  newPresetLabel: $('new-preset-label'),
  editor: $('editor'),
  editorForm: $('editor-form'),
  editorTitle: $('editor-title'),
  presetName: $('preset-name'),
  editorStrings: $('editor-strings'),
  editorError: $('editor-error'),
  deletePreset: $('delete-preset'),
  cancelEdit: $('cancel-edit'),
  settingsSheet: $('settings-sheet'),
  signal: $('signal'),
  sensitivity: $('sensitivity'),
  chimeToggle: $('chime-toggle'),
  viewButtons: document.querySelectorAll('.view-btn'),
  tunerView: $('tuner-view'),
  tabsView: $('tabs-view'),
};

const state = {
  presets: [],
  activeId: null,
  lockedIndex: null, // cuerda fijada al tocarla en pantalla (null = detección automática)
  detectedIndex: null,
  displayCents: 0,
  lastSignalAt: 0,
  idle: true,
  inTuneSince: null,
  tuned: new Set(),
  completeUntil: 0, // > 0 mientras se muestra "Guitarra afinada"
  editingId: null, // null = creando una nueva
  sensitivityDb: DEFAULT_SENSITIVITY_DB,
  chime: true,
  referencePlaying: false,
  ignoreUntil: 0, // hasta cuándo ignorar el micrófono tras el tono de referencia o el aviso
  view: 'tuner', // 'tuner' | 'tabs'
  mic: 'off', // 'off' | 'starting' | 'on' | 'error'
  micError: '',
  micPermission: 'prompt', // estado del permiso del navegador, si se puede consultar
  announced: '',
};

let tuner = null;
let tabView = null;
const toast = createToast();

const activePreset = () => state.presets.find((p) => p.id === state.activeId) ?? state.presets[0];
const showError = (message) => toast.show(message, { error: true });
const noteLabel = (hz) => noteFromFrequency(hz).label;
const formatCents = (c) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)} ¢`;

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
    const [x2, y2] = pointOnArc(angle, major ? 102 : 111);
    const line = document.createElementNS(ns, 'line');
    Object.entries({ x1, y1, x2, y2, class: major ? 'tick major' : 'tick' }).forEach(([k, v]) => line.setAttribute(k, v));
    els.gaugeTicks.append(line);
  }
  const [zx1, zy1] = pointOnArc(centsToAngle(-IN_TUNE_CENTS), 120);
  const [zx2, zy2] = pointOnArc(centsToAngle(IN_TUNE_CENTS), 120);
  els.gaugeZone.setAttribute('d', `M ${zx1} ${zy1} A 120 120 0 0 1 ${zx2} ${zy2}`);
}

function setNeedle(cents) {
  els.needle.style.transform = `rotate(${centsToAngle(cents)}deg)`;
}

/** Estado visual del medidor: 'off' | 'idle' | 'flat' | 'sharp' | 'in-tune' | 'complete', más 'playing'. */
function setMeter(mode) {
  els.meter.className = `meter ${mode}${state.referencePlaying ? ' playing' : ''}`;
}

function setStatus(word, detail, spoken) {
  els.statusWord.textContent = word;
  els.statusDetail.textContent = detail;
  // Solo se anuncia cuando cambia el estado, no en cada lectura.
  if (spoken !== state.announced) {
    state.announced = spoken;
    els.status.textContent = spoken;
  }
}

function lockedDetail() {
  const i = state.lockedIndex;
  return i === null ? 'Detecto sola qué cuerda tocas' : `Solo escucho la ${stringNumber(i)}ª cuerda`;
}

/** Texto del medidor cuando no hay una lectura en curso. */
function renderRest() {
  if (state.completeUntil) {
    setMeter('complete');
    setStatus('Guitarra afinada', 'Las 6 cuerdas quedaron afinadas', 'Guitarra afinada: las 6 cuerdas quedaron afinadas');
    return;
  }
  if (state.referencePlaying) {
    const index = state.lockedIndex ?? state.detectedIndex;
    const label = noteLabel(activePreset().strings[index]);
    setMeter(state.mic === 'on' ? 'idle' : 'off');
    setStatus(`Sonando ${label}`, 'Compárala con tu cuerda', `Sonando ${label}`);
    return;
  }
  if (state.mic === 'on') {
    setMeter('idle');
    setStatus('Haz sonar una cuerda', lockedDetail(), 'Esperando sonido');
    return;
  }
  if (state.mic === 'starting') {
    setMeter('off starting');
    setStatus('Conectando…', 'Acepta el permiso del micrófono si el navegador lo pide', 'Conectando el micrófono');
  } else if (state.mic === 'error') {
    setMeter('off error');
    setStatus('Sin micrófono', state.micError, `Sin micrófono. ${state.micError}`);
  } else {
    setMeter('off');
    setStatus('Activar micrófono', 'El audio no sale de tu dispositivo', 'Micrófono apagado');
  }
}

function showIdle() {
  if (state.idle) return;
  state.idle = true;
  state.detectedIndex = null;
  state.inTuneSince = null;
  state.displayCents = 0;
  setNeedle(0);
  renderTarget();
  highlightStrings();
  renderRest();
}

function onReading(freq, level) {
  updateSignal(level);
  const now = performance.now();
  // Mientras suena el tono de referencia el micrófono lo escucha: no se evalúa.
  // Tampoco fuera del afinador (p. ej. mientras suena una tablatura).
  if (state.view !== 'tuner' || state.referencePlaying || now < state.ignoreUntil) return;
  if (freq == null) {
    if (now - state.lastSignalAt > SIGNAL_TIMEOUT_MS) showIdle();
    return;
  }
  const preset = activePreset();
  const { index, cents } =
    state.lockedIndex !== null
      ? { index: state.lockedIndex, cents: centsBetween(freq, preset.strings[state.lockedIndex]) }
      : nearestString(freq, preset.strings);

  // "Guitarra afinada" se mantiene mientras lo que suene siga afinado; se va al desafinar algo.
  if (state.completeUntil) {
    state.lastSignalAt = now;
    if (now < state.completeUntil || Math.abs(cents) <= IN_TUNE_CENTS * 2) return;
    state.completeUntil = 0;
  }
  state.lastSignalAt = now;
  state.idle = false;

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
  const rounded = Math.round(shown);
  const inTune = Math.abs(shown) <= IN_TUNE_CENTS;
  const flat = shown < 0;
  setNeedle(shown);
  setMeter(inTune ? 'in-tune' : flat ? 'flat' : 'sharp');

  const string = `${stringNumber(index)}ª cuerda`;
  if (inTune) {
    setStatus('Afinada', formatCents(rounded), `${string}: afinada`);
  } else if (Math.abs(shown) >= FAR_CENTS) {
    const sounding = noteLabel(freq);
    setStatus(flat ? 'Muy baja' : 'Muy alta', `Suena ${sounding} · ${flat ? 'tensa' : 'afloja'} la cuerda`, `${string}: muy ${flat ? 'baja' : 'alta'}`);
  } else {
    setStatus(flat ? 'Tensa' : 'Afloja', formatCents(rounded), `${string}: ${flat ? 'baja, tensa' : 'alta, afloja'}`);
  }

  if (inTune) {
    state.inTuneSince ??= now;
    if (now - state.inTuneSince >= HOLD_MS && !state.tuned.has(index)) markTuned(index, now);
  } else {
    state.inTuneSince = null;
  }
}

function markTuned(index, now) {
  state.tuned.add(index);
  highlightStrings();
  navigator.vibrate?.(40);
  if (state.chime) {
    chime();
    state.ignoreUntil = now + 450;
  }
  if (state.tuned.size === STRING_COUNT) {
    state.completeUntil = now + COMPLETE_HOLD_MS;
    state.detectedIndex = null;
    setNeedle(0);
    renderTarget();
    highlightStrings();
    renderRest();
  }
}

function renderTarget() {
  const index = state.lockedIndex ?? state.detectedIndex;
  if (index == null) {
    els.targetNote.textContent = '';
    els.targetString.textContent = '';
    els.noteRing.classList.add('empty');
    return;
  }
  const hz = activePreset().strings[index];
  els.targetNote.textContent = noteFromFrequency(hz).name;
  els.targetString.textContent = `${stringNumber(index)}ª`;
  els.noteRing.classList.remove('empty');
}

// ---------- Tono de referencia ----------

function playString(index) {
  stopReference();
  state.referencePlaying = true;
  state.completeUntil = 0;
  els.strings.querySelectorAll('.string-btn').forEach((b) => b.classList.toggle('sounding', Number(b.dataset.index) === index));
  renderTarget();
  renderRest();
  playReference(activePreset().strings[index], () => endReference(false));
}

function endReference(stop) {
  if (!state.referencePlaying) return;
  if (stop) stopReference();
  state.referencePlaying = false;
  state.ignoreUntil = performance.now() + REFERENCE_TAIL_MS;
  state.lastSignalAt = performance.now();
  els.strings.querySelectorAll('.sounding').forEach((b) => b.classList.remove('sounding'));
  renderRest();
}

// ---------- Señal y sensibilidad ----------

const SENSITIVITY_SPAN_DB = SENSITIVITY_MAX_DB - SENSITIVITY_MIN_DB;

function updateSignal(level) {
  const db = Math.max(SENSITIVITY_MIN_DB, Math.min(SENSITIVITY_MAX_DB, amplitudeToDb(level)));
  const fraction = (db - SENSITIVITY_MIN_DB) / SENSITIVITY_SPAN_DB;
  els.sensitivity.style.setProperty('--level', `${fraction * 100}%`);
  els.noteRing.style.setProperty('--level', fraction.toFixed(2));
  els.signal.classList.toggle('passing', level >= dbToAmplitude(state.sensitivityDb));
}

function applySensitivity(db) {
  state.sensitivityDb = db;
  els.sensitivity.value = db;
  if (tuner) tuner.minRms = dbToAmplitude(db);
}

async function saveSetting(changes) {
  try {
    await api.updateSettings(changes);
  } catch (err) {
    showError(`No se pudo guardar el ajuste: ${err.message}`);
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
      btn.setAttribute('aria-label', `${stringNumber(i)}ª cuerda, ${noteLabel(hz)}. Toca para escucharla`);
      btn.innerHTML = `
        <span class="string-line" aria-hidden="true"></span>
        <span class="string-num">${stringNumber(i)}</span>
        <span class="string-note">${noteFromFrequency(hz).name}</span>`;
      btn.append(icon('Check', 'string-check'));
      btn.addEventListener('click', () => onStringTap(i));
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
  els.modeChip.hidden = !locked;
  els.stringsHint.hidden = locked;
  if (locked) els.modeLabel.textContent = `${stringNumber(state.lockedIndex)}ª cuerda`;
}

/** Tocar una cuerda la hace sonar y la fija como objetivo; tocarla otra vez mientras suena la calla. */
function onStringTap(index) {
  if (state.lockedIndex === index && state.referencePlaying) return endReference(true);
  if (state.lockedIndex !== index) {
    state.lockedIndex = index;
    state.detectedIndex = null;
    state.inTuneSince = null;
    state.idle = true;
    setNeedle(0);
    highlightStrings();
  }
  playString(index);
}

function unlock() {
  endReference(true);
  state.lockedIndex = null;
  state.detectedIndex = null;
  state.inTuneSince = null;
  renderTarget();
  highlightStrings();
  renderRest();
}

// ---------- Afinaciones ----------

function renderTuningTitle() {
  const preset = activePreset();
  els.tuningName.textContent = preset.name;
  els.tuningNotes.textContent = tuningNotes(preset.strings);
  els.tuningBtn.setAttribute('aria-label', `Afinación: ${preset.name}, ${tuningNotes(preset.strings)}. Cambiar`);
}

function renderTuningList() {
  const active = activePreset();
  els.tuningList.replaceChildren(
    ...state.presets.map((p) => {
      const li = document.createElement('li');
      li.className = 'pick-item';
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pick-row';
      if (p.id === active.id) row.setAttribute('aria-current', 'true');
      row.innerHTML = `<span class="pick-main"><span class="pick-name"></span><span class="pick-sub">${tuningNotes(p.strings)}</span></span>`;
      row.querySelector('.pick-name').textContent = p.name;
      row.append(icon('Check', 'pick-check'));
      row.addEventListener('click', () => {
        els.tuningSheet.close();
        if (p.id !== state.activeId) selectPreset(p.id);
      });
      li.append(row);
      if (!p.isDefault) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'icon-btn ghost';
        edit.setAttribute('aria-label', `Editar ${p.name}`);
        edit.title = 'Editar';
        edit.append(icon('Pencil'));
        edit.addEventListener('click', () => {
          els.tuningSheet.close();
          openEditor(p);
        });
        li.append(edit);
      }
      return li;
    }),
  );
  els.newPresetLabel.textContent = `Nueva a partir de ${active.name}`;
}

function openTuningSheet() {
  renderTuningList();
  els.tuningSheet.showModal();
  els.tuningList.querySelector('[aria-current]')?.focus();
}

function applySnapshot({ presets, activeId }) {
  state.presets = presets;
  state.activeId = activeId;
  resetTuningSession();
  renderTuningTitle();
  renderStrings();
  tabView?.onTuningChange();
}

function resetTuningSession() {
  endReference(true);
  state.lockedIndex = null;
  state.detectedIndex = null;
  state.inTuneSince = null;
  state.completeUntil = 0;
  state.tuned.clear();
  renderTarget();
  renderRest();
}

async function selectPreset(id) {
  state.activeId = id;
  resetTuningSession();
  renderTuningTitle();
  renderStrings();
  tabView?.onTuningChange();
  try {
    await api.setActivePreset(id);
  } catch (err) {
    showError(`No se pudo guardar la afinación elegida: ${err.message}`);
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
  els.presetName.value = preset ? preset.name : `${base.name} (mía)`.slice(0, 40);
  els.presetName.removeAttribute('aria-invalid');
  els.editorError.hidden = true;
  els.deletePreset.hidden = !preset;

  els.editorStrings.replaceChildren(
    ...base.strings.map((hz, i) => {
      const row = document.createElement('label');
      row.className = 'editor-row';
      row.style.setProperty('--gauge', `${1 + (STRING_COUNT - 1 - i) * 0.5}px`);
      row.innerHTML = `
        <span class="editor-label">
          <span class="string-num">${stringNumber(i)}</span>
          <span class="string-line" aria-hidden="true"></span>
        </span>
        <span class="editor-input">
          <input type="number" inputmode="decimal" step="0.01" min="${MIN_HZ}" max="${MAX_HZ}" required aria-label="${stringNumber(i)}ª cuerda en Hz" />
          <span class="editor-unit" aria-hidden="true">Hz</span>
        </span>
        <span class="editor-note" aria-live="off"></span>`;
      const input = row.querySelector('input');
      const note = row.querySelector('.editor-note');
      const updateNote = () => {
        input.removeAttribute('aria-invalid');
        const value = Number(input.value);
        if (input.value === '' || !Number.isFinite(value) || value < MIN_HZ || value > MAX_HZ) {
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
  if (canAutofocus()) els.presetName.focus();
}

function editorError(message, field) {
  els.editorError.textContent = message;
  els.editorError.hidden = false;
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
}

async function saveEditor(event) {
  event.preventDefault();
  const inputs = [...els.editorStrings.querySelectorAll('input')];
  const { value, error } = validatePreset({
    name: els.presetName.value,
    strings: inputs.map((input) => (input.value === '' ? NaN : Number(input.value))),
  });
  if (error) {
    const badString = inputs.find((input) => {
      const hz = Number(input.value);
      return input.value === '' || !Number.isFinite(hz) || hz < MIN_HZ || hz > MAX_HZ;
    });
    return editorError(error, els.presetName.value.trim() ? badString : els.presetName);
  }
  try {
    const saved = state.editingId ? await api.updatePreset(state.editingId, value) : await api.createPreset(value);
    await api.setActivePreset(saved.id);
    await reloadPresets();
    els.editor.close();
  } catch (err) {
    editorError(err.message);
  }
}

async function deleteEditing() {
  const preset = state.presets.find((p) => p.id === state.editingId);
  if (!preset) return;
  const wasActive = preset.id === state.activeId;
  try {
    await api.deletePreset(preset.id);
    await reloadPresets();
    els.editor.close();
    toast.show(`Se eliminó «${preset.name}»`, {
      onAction: async () => {
        try {
          const restored = await api.createPreset({ name: preset.name, strings: preset.strings });
          if (wasActive) await api.setActivePreset(restored.id);
          await reloadPresets();
        } catch (err) {
          showError(`No se pudo recuperar: ${err.message}`);
        }
      },
    });
  } catch (err) {
    editorError(err.message);
  }
}

// ---------- Micrófono ----------

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function micDeniedHelp() {
  const where = isIOS()
    ? 'En Safari: aA › Ajustes del sitio web › Micrófono › Permitir.'
    : 'Permítelo desde el ícono de la barra de direcciones.';
  return `${where} Mientras, puedes afinar de oído tocando una cuerda.`;
}

async function startTuner() {
  if (state.mic === 'on' || state.mic === 'starting') return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    state.mic = 'error';
    state.micError = 'El micrófono necesita una conexión segura (HTTPS). Puedes afinar de oído tocando una cuerda.';
    return renderRest();
  }
  state.mic = 'starting';
  renderRest();
  // La reproducción de tablaturas puede haber fijado la sesión de audio de iOS solo para salida.
  if (navigator.audioSession) navigator.audioSession.type = 'auto';
  try {
    tuner = new Tuner(onReading);
    tuner.minRms = dbToAmplitude(state.sensitivityDb);
    await tuner.start();
    keepScreenAwake();
    state.mic = 'on';
    state.micPermission = 'granted';
    state.idle = true;
    state.lastSignalAt = 0;
  } catch (err) {
    tuner = null;
    state.mic = 'error';
    state.micError =
      err.name === 'NotAllowedError'
        ? `Permiso denegado. ${micDeniedHelp()}`
        : err.name === 'NotFoundError'
          ? 'No se encontró ningún micrófono. Puedes afinar de oído tocando una cuerda.'
          : `No se pudo iniciar el micrófono (${err.message}). Toca el botón para reintentar.`;
  }
  renderRest();
}

/** Si el permiso ya estaba concedido, el primer toque en cualquier parte enciende el micrófono. */
function watchPermission() {
  navigator.permissions
    ?.query({ name: 'microphone' })
    .then((status) => {
      state.micPermission = status.state;
      status.onchange = () => (state.micPermission = status.state);
    })
    .catch(() => {});
  const onFirstGesture = () => {
    if (state.micPermission === 'granted' && state.mic === 'off') startTuner();
  };
  document.addEventListener('pointerdown', onFirstGesture, { once: true, capture: true });
}

// ---------- Vistas (afinador / tablaturas) ----------

function setView(view, { save = true } = {}) {
  state.view = view;
  const tuning = view === 'tuner';
  els.tunerView.hidden = !tuning;
  els.tabsView.hidden = tuning;
  document.body.dataset.view = view;
  els.viewButtons.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.view === view)));
  if (tuning) {
    tabView.deactivate();
    state.lastSignalAt = 0;
  } else {
    endReference(true);
    showIdle();
    tabView.activate();
  }
  if (save) saveSetting({ view });
}

// ---------- Inicio ----------

function bindEvents() {
  [els.tuningSheet, els.editor, els.settingsSheet].forEach(setupSheet);
  els.tuningBtn.addEventListener('click', openTuningSheet);
  els.newPreset.addEventListener('click', () => {
    els.tuningSheet.close();
    openEditor(null);
  });
  els.settingsBtn.addEventListener('click', () => els.settingsSheet.showModal());
  els.modeChip.addEventListener('click', unlock);
  els.startBtn.addEventListener('click', startTuner);
  els.editorForm.addEventListener('submit', saveEditor);
  els.cancelEdit.addEventListener('click', () => els.editor.close());
  els.deletePreset.addEventListener('click', deleteEditing);
  els.sensitivity.addEventListener('input', () => applySensitivity(Number(els.sensitivity.value)));
  els.sensitivity.addEventListener('change', () => saveSetting({ sensitivityDb: state.sensitivityDb }));
  els.chimeToggle.addEventListener('change', () => {
    state.chime = els.chimeToggle.checked;
    saveSetting({ chime: state.chime });
    if (state.chime) chime();
  });
  els.viewButtons.forEach((btn) => btn.addEventListener('click', () => btn.dataset.view !== state.view && setView(btn.dataset.view)));
}

async function init() {
  mountIcons();
  buildGauge();
  tabView = createTabView({
    api,
    getStrings: () => activePreset().strings,
    showError,
    showToast: toast.show,
    isMicActive: () => state.mic === 'on',
  });
  bindEvents();
  watchPermission();
  els.sensitivity.min = SENSITIVITY_MIN_DB;
  els.sensitivity.max = SENSITIVITY_MAX_DB;
  applySensitivity(DEFAULT_SENSITIVITY_DB);
  const [presets, settings] = await Promise.allSettled([reloadPresets(), api.fetchSettings()]);
  if (presets.status === 'rejected') showError(`No se pudieron cargar las afinaciones: ${presets.reason.message}`);
  await tabView.load();
  if (settings.status === 'fulfilled') {
    applySensitivity(settings.value.sensitivityDb);
    state.chime = settings.value.chime;
    els.chimeToggle.checked = state.chime;
    setView(settings.value.view, { save: false });
  } else {
    showError(`No se pudieron cargar los ajustes: ${settings.reason.message}`);
    setView('tuner', { save: false });
  }
}

init();
