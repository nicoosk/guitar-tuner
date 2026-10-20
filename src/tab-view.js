// Vista de tablaturas: lista, ajustes (nombre, largo, compás), grilla editable de 6 cuerdas
// y reproducción con la afinación seleccionada en ese momento.

import { audioContext, pluck } from './reference.js';
import { TabPlayer } from './tab-player.js';
import {
  BPM_MAX,
  BPM_MIN,
  DEFAULT_TAB,
  exampleTab,
  fretFrequency,
  MAX_FRET,
  MEASURES_MAX,
  resizeNotes,
  stepCount,
  stepsPerMeasure,
  SUBDIVISIONS,
  validateTab,
} from './tabs.js';
import { icon } from './icons.js';
import { noteFromFrequency, stringNumber, STRING_COUNT } from './tuning.js';
import { canAutofocus, setupSheet } from './ui.js';
import { keepScreenAwake } from './wakelock.js';

const ROWS = [5, 4, 3, 2, 1, 0]; // como en una tablatura impresa: 1ª cuerda arriba, 6ª abajo
const BPM_STEP = 5;
const FRET_TYPING_MS = 800; // ventana para escribir trastes de dos dígitos con el teclado

const $ = (id) => document.getElementById(id);

/**
 * @param {object} deps
 * @param {typeof import('./api.js')} deps.api
 * @param {() => number[]} deps.getStrings     Hz de las cuerdas según la afinación activa
 * @param {(message: string) => void} deps.showError
 * @param {(message: string, options?: object) => void} deps.showToast
 * @param {() => boolean} deps.isMicActive
 */
export function createTabView({ api, getStrings, showError, showToast, isMicActive }) {
  const els = {
    view: $('tabs-view'),
    title: $('tab-title'),
    nameLabel: $('tab-name-label'),
    edit: $('edit-tab'),
    empty: $('tab-empty'),
    emptyCreate: $('tab-empty-create'),
    emptyExample: $('tab-empty-example'),
    workspace: $('tab-workspace'),
    play: $('tab-play'),
    bpmDown: $('bpm-down'),
    bpmUp: $('bpm-up'),
    bpmInput: $('bpm-input'),
    loop: $('tab-loop'),
    metronome: $('tab-metronome'),
    scroll: $('tab-scroll'),
    grid: $('tab-grid'),
    padLabel: $('fret-pad-label'),
    padPrev: $('fret-prev'),
    padNext: $('fret-next'),
    keys: $('fret-keys'),
    sheet: $('tab-sheet'),
    list: $('tab-list'),
    create: $('new-tab'),
    editor: $('tab-editor'),
    editorForm: $('tab-editor-form'),
    editorCancel: $('tab-editor-cancel'),
    editorDelete: $('tab-editor-delete'),
    editorWarning: $('tab-editor-warning'),
    editorError: $('tab-editor-error'),
    name: $('tab-name'),
    measures: $('tab-measures'),
    beats: $('tab-beats'),
    subdivision: $('tab-subdivision'),
  };

  const state = {
    tabs: [],
    activeTabId: null,
    sel: { step: 0, string: 5 },
    fretBuffer: '',
    fretTypedAt: 0,
    active: false,
  };
  let colEls = [];
  let playingCol = null;

  const tab = () => state.tabs.find((t) => t.id === state.activeTabId) ?? null;
  const fretAt = (step, string) => tab()?.notes.find((n) => n[0] === step && n[1] === string)?.[2] ?? null;
  const cellEl = (step, string) => colEls[step]?.children[1 + ROWS.indexOf(string)];
  const describe = (t) => `${t.measures === 1 ? '1 compás' : `${t.measures} compases`} · ${t.beatsPerMeasure}/4 · ${t.bpm} BPM`;

  const player = new TabPlayer({ getTab: tab, getStrings, onStep: showPlayhead });

  // ---------- Persistencia ----------

  function persist() {
    const current = tab();
    if (!current) return;
    api.updateTab(current.id, current).catch((err) => showError(`No se pudo guardar la tablatura: ${err.message}`));
  }

  async function load() {
    try {
      applySnapshot(await api.fetchTabs());
    } catch (err) {
      showError(`No se pudieron cargar las tablaturas: ${err.message}`);
    }
  }

  function applySnapshot({ tabs, activeTabId }) {
    player.stop();
    state.tabs = tabs;
    state.activeTabId = activeTabId;
    state.sel = { step: 0, string: 5 };
    render();
  }

  async function selectTab(id) {
    player.stop();
    state.activeTabId = id;
    state.sel = { step: 0, string: 5 };
    render();
    try {
      await api.setActiveTab(id);
    } catch (err) {
      showError(`No se pudo guardar la tablatura elegida: ${err.message}`);
    }
  }

  async function createNew(fields = null) {
    try {
      const created = await api.createTab(fields ?? { name: nextName(), ...DEFAULT_TAB, notes: [] });
      applySnapshot({ tabs: [...state.tabs, created], activeTabId: created.id });
      if (state.active) els.grid.focus({ preventScroll: true });
    } catch (err) {
      showError(`No se pudo crear la tablatura: ${err.message}`);
    }
  }

  function nextName() {
    const names = new Set(state.tabs.map((t) => t.name));
    let n = state.tabs.length + 1;
    while (names.has(`Tablatura ${n}`)) n += 1;
    return `Tablatura ${n}`;
  }

  // ---------- Render ----------

  function render() {
    const current = tab();
    els.empty.hidden = Boolean(current);
    els.workspace.hidden = !current;
    if (!current) return;
    els.nameLabel.textContent = current.name;
    els.title.setAttribute('aria-label', `Tablatura: ${current.name}. Cambiar`);
    els.bpmInput.value = current.bpm;
    renderGrid();
    renderPad();
  }

  function renderList() {
    const current = tab();
    els.list.replaceChildren(
      ...state.tabs.map((t) => {
        const li = document.createElement('li');
        li.className = 'pick-item';
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'pick-row';
        if (t.id === current?.id) row.setAttribute('aria-current', 'true');
        row.innerHTML = '<span class="pick-main"><span class="pick-name"></span><span class="pick-sub"></span></span>';
        row.querySelector('.pick-name').textContent = t.name;
        row.querySelector('.pick-sub').textContent = describe(t);
        row.append(icon('Check', 'pick-check'));
        row.addEventListener('click', () => {
          els.sheet.close();
          if (t.id !== state.activeTabId) selectTab(t.id);
        });
        li.append(row);
        return li;
      }),
    );
  }

  function renderGrid() {
    const current = tab();
    const strings = getStrings();
    const perMeasure = stepsPerMeasure(current);
    const frets = new Map(current.notes.map(([step, string, fret]) => [`${step}:${string}`, fret]));

    const labels = ROWS.map((string) => {
      const note = noteFromFrequency(strings[string]);
      return `<span class="tab-label" title="${stringNumber(string)}ª cuerda (${note.label})" style="--gauge:${gauge(string)}">${note.name}</span>`;
    }).join('');

    let cols = '';
    for (let step = 0; step < stepCount(current); step++) {
      const bar = step % perMeasure === 0;
      const head = bar ? step / perMeasure + 1 : '';
      const alt = Math.floor(step / current.subdivision) % 2 === 1; // tiempos alternados con otro fondo
      const cells = ROWS.map((string) => `<span class="cell" data-string="${string}" style="--gauge:${gauge(string)}">${fretMarkup(frets.get(`${step}:${string}`))}</span>`).join('');
      cols += `<div class="tab-col${bar ? ' bar' : ''}${alt ? ' alt' : ''}" data-step="${step}"><span class="col-head">${head}</span>${cells}</div>`;
    }
    const canGrow = current.measures < MEASURES_MAX;
    const add = canGrow ? '<button type="button" class="add-measure" aria-label="Agregar un compás" title="Agregar un compás"></button>' : '';

    els.grid.innerHTML = `<div class="tab-labels"><span class="col-head"></span>${labels}</div>${cols}${add}`;
    els.grid.querySelector('.add-measure')?.append(icon('Plus'));
    colEls = [...els.grid.querySelectorAll('.tab-col')];
    playingCol = null;
    state.sel.step = Math.min(state.sel.step, colEls.length - 1);
    cellEl(state.sel.step, state.sel.string)?.classList.add('selected');
  }

  const gauge = (string) => `${1 + (STRING_COUNT - 1 - string) * 0.4}px`;
  const fretMarkup = (fret) => (fret === undefined || fret === null ? '' : `<b>${fret}</b>`);

  function renderPad() {
    const { step, string } = state.sel;
    const current = tab();
    const perMeasure = stepsPerMeasure(current);
    const measure = Math.floor(step / perMeasure) + 1;
    const beat = Math.floor((step % perMeasure) / current.subdivision) + 1;
    const fret = fretAt(step, string);
    const open = getStrings()[string];
    const sounding = fret === null ? '' : ` · ${noteFromFrequency(fretFrequency(open, fret)).label}`;
    els.padLabel.textContent = `${stringNumber(string)}ª cuerda · compás ${measure}, tiempo ${beat}${sounding}`;
    els.keys.querySelectorAll('.fret-key').forEach((key) => key.classList.toggle('current', Number(key.dataset.fret) === fret));
    els.padClear.disabled = fret === null;
    els.padPrev.disabled = step === 0;
    els.padNext.disabled = step === stepCount(current) - 1;
  }

  function buildKeys() {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'fret-key fret-clear';
    clear.title = 'Borrar nota';
    clear.setAttribute('aria-label', 'Borrar nota');
    clear.append(icon('Eraser'));
    els.padClear = clear;
    els.keys.replaceChildren(
      ...Array.from({ length: MAX_FRET + 1 }, (_, fret) => {
        const key = document.createElement('button');
        key.type = 'button';
        key.className = 'fret-key';
        key.dataset.fret = fret;
        key.textContent = fret;
        key.setAttribute('aria-label', `Traste ${fret}`);
        return key;
      }),
      clear,
    );
  }

  // ---------- Edición ----------

  function select(step, string) {
    const current = tab();
    if (!current) return;
    step = Math.max(0, Math.min(stepCount(current) - 1, step));
    string = Math.max(0, Math.min(STRING_COUNT - 1, string));
    cellEl(state.sel.step, state.sel.string)?.classList.remove('selected');
    state.sel = { step, string };
    state.fretBuffer = '';
    cellEl(step, string)?.classList.add('selected');
    ensureVisible(step);
    renderPad();
  }

  function setFret(fret) {
    const current = tab();
    if (!current) return;
    const { step, string } = state.sel;
    current.notes = current.notes.filter((n) => !(n[0] === step && n[1] === string));
    if (fret !== null) {
      current.notes.push([step, string, fret]);
      current.notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (!player.playing) pluck(fretFrequency(getStrings()[string], fret), audioContext().currentTime, { duration: 1.2, volume: 0.35 });
    }
    cellEl(step, string).innerHTML = fretMarkup(fret);
    player.refresh();
    renderPad();
    persist();
  }

  function addMeasure() {
    const current = tab();
    if (!current || current.measures >= MEASURES_MAX) return;
    current.measures += 1;
    const firstNew = stepCount(current) - stepsPerMeasure(current);
    renderGrid();
    player.refresh();
    persist();
    select(firstNew, state.sel.string);
  }

  /** Teclado físico: dígitos (dos seguidos = traste de dos cifras), flechas, borrar y espacio. */
  function onKeyDown(event) {
    if (!state.active || !tab() || document.querySelector('dialog[open]')) return;
    if (event.target.closest?.('input, select, textarea') || event.metaKey || event.ctrlKey || event.altKey) return;
    const { step, string } = state.sel;
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (/^\d$/.test(event.key)) {
      const now = performance.now();
      const combined = Number(state.fretBuffer + event.key);
      const fresh = !state.fretBuffer || now - state.fretTypedAt > FRET_TYPING_MS || combined > MAX_FRET;
      const fret = fresh ? Number(event.key) : combined;
      setFret(fret);
      state.fretBuffer = fresh && fret * 10 <= MAX_FRET ? event.key : '';
      state.fretTypedAt = now;
    } else if (moves[event.key]) {
      const [dStep, dString] = moves[event.key];
      select(step + dStep, string + dString);
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      setFret(null);
    } else if (event.key === ' ') {
      togglePlay();
    } else {
      return;
    }
    event.preventDefault();
  }

  // ---------- Reproducción ----------

  function togglePlay() {
    if (player.playing) return player.stop();
    // En iOS, sin esto el interruptor de silencio apaga el audio web (solo si no se usa el micrófono).
    if (navigator.audioSession && !isMicActive()) navigator.audioSession.type = 'playback';
    keepScreenAwake();
    player.start(0);
    els.play.classList.add('playing');
    els.play.setAttribute('aria-label', 'Detener');
  }

  function showPlayhead(step) {
    playingCol?.classList.remove('playing');
    playingCol = step === null ? null : colEls[step];
    playingCol?.classList.add('playing');
    if (step === null) {
      els.play.classList.remove('playing');
      els.play.setAttribute('aria-label', 'Reproducir');
    } else {
      ensureVisible(step);
    }
  }

  /** Desplaza la grilla para que la columna `step` quede visible (sin quedar bajo las etiquetas fijas). */
  function ensureVisible(step) {
    const col = colEls[step];
    if (!col) return;
    const labelsWidth = els.grid.firstElementChild.offsetWidth;
    const left = col.offsetLeft - labelsWidth;
    const right = col.offsetLeft + col.offsetWidth;
    const { scrollLeft, clientWidth } = els.scroll;
    if (left < scrollLeft) els.scroll.scrollLeft = left - col.offsetWidth;
    else if (right > scrollLeft + clientWidth) els.scroll.scrollLeft = right - clientWidth + col.offsetWidth * 2;
  }

  function setBpm(value) {
    const current = tab();
    const bpm = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(Number(value))));
    if (!current || !Number.isFinite(bpm)) return (els.bpmInput.value = current?.bpm ?? '');
    current.bpm = bpm;
    els.bpmInput.value = bpm;
    persist();
  }

  function toggleOption(button, key) {
    player[key] = !player[key];
    button.setAttribute('aria-pressed', String(player[key]));
  }

  // ---------- Ajustes ----------

  function readFields() {
    return {
      name: els.name.value,
      measures: els.measures.value === '' ? NaN : Number(els.measures.value),
      beatsPerMeasure: els.beats.value === '' ? NaN : Number(els.beats.value),
      subdivision: Number(els.subdivision.value),
    };
  }

  /** Avisa en el propio formulario qué notas se perderían o moverían con el nuevo largo/compás. */
  function updateWarning() {
    const current = tab();
    const fields = readFields();
    const valid = !validateTab({ ...current, ...fields, notes: [] }).error;
    const { dropped, moved } = valid ? resizeNotes(current, fields) : { dropped: 0, moved: 0 };
    const parts = [];
    if (dropped) parts.push(`${dropped === 1 ? 'Se eliminará 1 nota' : `Se eliminarán ${dropped} notas`} que quedan fuera del nuevo largo.`);
    if (moved) parts.push(`${moved === 1 ? '1 nota se moverá' : `${moved} notas se moverán`} al paso más cercano.`);
    els.editorWarning.textContent = parts.join(' ');
    els.editorWarning.hidden = parts.length === 0;
  }

  function openEditor() {
    const current = tab();
    if (!current) return;
    els.name.value = current.name;
    els.measures.value = current.measures;
    els.beats.value = current.beatsPerMeasure;
    els.subdivision.value = current.subdivision;
    els.editorError.hidden = true;
    els.editorWarning.hidden = true;
    els.name.removeAttribute('aria-invalid');
    els.editor.showModal();
    if (canAutofocus()) els.name.focus();
  }

  function editorError(message) {
    els.editorError.textContent = message;
    els.editorError.hidden = false;
  }

  async function saveEditor(event) {
    event.preventDefault();
    const current = tab();
    const fields = readFields();
    const { error } = validateTab({ ...fields, bpm: current.bpm, notes: [] });
    if (error) {
      if (!fields.name.trim()) {
        els.name.setAttribute('aria-invalid', 'true');
        els.name.focus();
      }
      return editorError(error);
    }
    try {
      player.stop();
      const { notes } = resizeNotes(current, fields);
      const saved = await api.updateTab(current.id, { ...fields, bpm: current.bpm, notes });
      state.tabs = state.tabs.map((t) => (t.id === saved.id ? saved : t));
      render();
      els.editor.close();
    } catch (err) {
      editorError(err.message);
    }
  }

  async function deleteCurrent() {
    const current = tab();
    if (!current) return;
    try {
      applySnapshot(await api.deleteTab(current.id));
      els.editor.close();
      showToast(`Se eliminó «${current.name}»`, {
        onAction: () => createNew({ ...current }),
      });
    } catch (err) {
      editorError(err.message);
    }
  }

  // ---------- Eventos ----------

  function bindEvents() {
    [els.sheet, els.editor].forEach(setupSheet);
    els.subdivision.replaceChildren(
      ...SUBDIVISIONS.map(({ value, label }) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = `${value} · ${label}`;
        return opt;
      }),
    );
    els.bpmInput.min = BPM_MIN;
    els.bpmInput.max = BPM_MAX;

    els.title.addEventListener('click', () => {
      renderList();
      els.sheet.showModal();
      els.list.querySelector('[aria-current]')?.focus();
    });
    els.create.addEventListener('click', () => {
      els.sheet.close();
      createNew();
    });
    els.edit.addEventListener('click', openEditor);
    els.emptyCreate.addEventListener('click', () => createNew());
    els.emptyExample.addEventListener('click', () => createNew(exampleTab()));
    els.play.addEventListener('click', togglePlay);
    els.bpmDown.addEventListener('click', () => setBpm((tab()?.bpm ?? 0) - BPM_STEP));
    els.bpmUp.addEventListener('click', () => setBpm((tab()?.bpm ?? 0) + BPM_STEP));
    els.bpmInput.addEventListener('change', () => setBpm(els.bpmInput.value));
    els.loop.addEventListener('click', () => toggleOption(els.loop, 'loop'));
    els.metronome.addEventListener('click', () => toggleOption(els.metronome, 'metronome'));
    els.grid.addEventListener('click', (event) => {
      if (event.target.closest('.add-measure')) return addMeasure();
      const cell = event.target.closest('.cell');
      if (cell) select(Number(cell.parentElement.dataset.step), Number(cell.dataset.string));
    });
    // En pantalla, tras elegir un traste se pasa al paso siguiente de la misma cuerda (para escribir melodías seguidas).
    els.keys.addEventListener('click', (event) => {
      const key = event.target.closest('.fret-key[data-fret]');
      if (!key) return;
      setFret(Number(key.dataset.fret));
      if (state.sel.step < colEls.length - 1) select(state.sel.step + 1, state.sel.string);
    });
    els.padPrev.addEventListener('click', () => select(state.sel.step - 1, state.sel.string));
    els.padNext.addEventListener('click', () => select(state.sel.step + 1, state.sel.string));
    els.padClear.addEventListener('click', () => setFret(null));
    els.editorForm.addEventListener('submit', saveEditor);
    els.editorForm.addEventListener('input', updateWarning);
    els.editorCancel.addEventListener('click', () => els.editor.close());
    els.editorDelete.addEventListener('click', deleteCurrent);
    document.addEventListener('keydown', onKeyDown);
  }

  buildKeys();
  bindEvents();

  return {
    load,
    activate() {
      state.active = true;
      if (tab()) ensureVisible(state.sel.step);
    },
    deactivate() {
      state.active = false;
      player.stop();
    },
    /** La afinación activa cambió: nombres de cuerdas y notas se recalculan (y lo que suene usa la nueva). */
    onTuningChange() {
      if (!tab()) return;
      renderGrid();
      renderPad();
    },
  };
}
