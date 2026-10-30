// Primer corte de "Mi música": un repertorio de ejemplo para probar el flujo antes de guardar datos o audio.

import { icon } from './icons.js';
import { getRecording, waveformFor } from './audio-library.js';

const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
const FALLBACK_WAVEFORM = [4, 8, 15, 22, 11, 3, 2, 7, 17, 25, 14, 5, 2, 9, 19, 27, 13, 4, 2, 6, 16, 24, 10, 3, 2, 8, 20, 26, 12, 4, 2, 7, 15, 21, 9, 3, 2, 5, 12, 6];

/** Reproductor visual del prototipo. Al guardar audio real, su reloj se conecta a HTMLAudioElement.currentTime. */
function createWaveformPlayer(entry, cleanups) {
  const waveform = entry.waveform ?? FALLBACK_WAVEFORM;
  let duration = entry.duration || 1;
  const player = document.createElement('div');
  player.className = 'wave-player';
  player.setAttribute('aria-label', `Reproductor de ${entry.title}`);

  const controls = document.createElement('div');
  controls.className = 'wave-controls';
  const restart = document.createElement('button');
  restart.type = 'button';
  restart.className = 'wave-control';
  restart.title = 'Volver al inicio';
  restart.setAttribute('aria-label', `Volver al inicio de ${entry.title}`);
  restart.append(icon('RotateCcw'));
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'wave-control wave-play';
  controls.append(restart, toggle);

  const track = document.createElement('div');
  track.className = 'wave-track';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${waveform.length * 5} 40`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const bars = waveform.map((height, index) => {
    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bar.setAttribute('x', String(index * 5 + 1));
    bar.setAttribute('y', String(20 - height / 2));
    bar.setAttribute('width', '3');
    bar.setAttribute('height', String(height));
    bar.setAttribute('rx', '1.5');
    svg.append(bar);
    return bar;
  });
  const playhead = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  playhead.setAttribute('y1', '1');
  playhead.setAttribute('y2', '39');
  playhead.classList.add('wave-playhead');
  svg.append(playhead);
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.min = '0';
  seek.max = String(duration);
  seek.step = '1';
  seek.value = '0';
  seek.setAttribute('aria-label', `Posición en ${entry.title}`);
  track.append(svg, seek);

  const time = document.createElement('output');
  time.className = 'wave-time';
  time.setAttribute('aria-live', 'off');
  let progress = 0;
  let playing = false;
  let timer = null;
  let audio = null;

  const render = () => {
    const fraction = progress / duration;
    const playedBars = Math.round(fraction * waveform.length);
    bars.forEach((bar, index) => bar.style.setProperty('fill', index < playedBars ? 'var(--string-edge)' : 'var(--muted)'));
    playhead.setAttribute('x1', String(fraction * waveform.length * 5));
    playhead.setAttribute('x2', String(fraction * waveform.length * 5));
    seek.value = String(Math.round(progress));
    seek.setAttribute('aria-valuetext', `${formatTime(progress)} de ${formatTime(duration)}`);
    time.value = `${formatTime(progress)} / ${formatTime(duration)}`;
    time.textContent = time.value;
    toggle.replaceChildren(icon(playing ? 'Pause' : 'Play'));
    toggle.title = playing ? 'Pausar' : 'Reproducir';
    toggle.setAttribute('aria-label', `${playing ? 'Pausar' : 'Reproducir'} ${entry.title}`);
  };
  const stop = () => {
    playing = false;
    if (timer) clearInterval(timer);
    timer = null;
  };
  const play = () => {
    if (progress >= duration) progress = 0;
    playing = true;
    timer = setInterval(() => {
      progress = Math.min(duration, progress + 0.25);
      if (progress >= duration) stop();
      render();
    }, 250);
  };
  restart.addEventListener('click', () => {
    progress = 0;
    render();
  });
  toggle.addEventListener('click', () => {
    if (audio) {
      if (audio.paused) { audio.play().catch(() => {}); playing = true; }
      else { audio.pause(); playing = false; }
    } else if (playing) stop();
    else play();
    render();
  });
  seek.addEventListener('input', () => {
    progress = Number(seek.value);
    render();
  });
  getRecording(entry.audioId).then((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    audio = new Audio(url);
    audio.addEventListener('loadedmetadata', () => { duration = audio.duration; seek.max = String(Math.ceil(duration)); render(); });
    audio.addEventListener('timeupdate', () => { progress = audio.currentTime; render(); });
    audio.addEventListener('ended', () => { stop(); progress = duration; render(); });
    seek.addEventListener('input', () => { audio.currentTime = progress; });
    restart.addEventListener('click', () => { audio.currentTime = 0; });
    cleanups.push(() => { audio.pause(); URL.revokeObjectURL(url); });
    waveformFor(blob, bars.length).then((peaks) => peaks.forEach((peak, index) => {
      const height = 3 + peak * 28;
      bars[index].setAttribute('y', String(20 - height / 2));
      bars[index].setAttribute('height', String(height));
    })).catch(() => {});
  }).catch(() => {});
  cleanups.push(stop);
  render();
  player.append(controls, track, time);
  return player;
}

function createEmptyAudioPrompt(entry, onRecord) {
  const prompt = document.createElement('div');
  prompt.className = 'wave-empty';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${FALLBACK_WAVEFORM.length * 5} 40`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  FALLBACK_WAVEFORM.forEach((height, index) => {
    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bar.setAttribute('x', String(index * 5 + 1));
    bar.setAttribute('y', String(20 - height / 2));
    bar.setAttribute('width', '3');
    bar.setAttribute('height', String(height));
    bar.setAttribute('rx', '1.5');
    svg.append(bar);
  });
  const record = document.createElement('button');
  record.type = 'button';
  record.className = 'wave-record';
  record.setAttribute('aria-label', `Grabar audio para ${entry.title}`);
  record.append(icon('Mic'), document.createTextNode(' Grabar'));
  record.addEventListener('click', async () => {
    try {
      record.disabled = true;
      const state = await onRecord(entry);
      if (state === 'recording') {
        record.replaceChildren(icon('Square'), document.createTextNode(' Detener'));
        record.setAttribute('aria-label', `Detener grabación de ${entry.title}`);
      }
    } catch (err) {
      record.replaceChildren(icon('TriangleAlert'), document.createTextNode(' Reintentar'));
      record.setAttribute('aria-label', `Reintentar grabación de ${entry.title}`);
    } finally { record.disabled = false; }
  });
  prompt.append(record, svg);
  return prompt;
}

export function createMusicView({ root, getPresets, getActiveId, onChooseTuning, onNew, onEdit, onRecord, onDelete, api }) {
  let category = 'improvisations';
  let cleanups = [];
  let library = [];

  const matchingPreset = (entry) => getPresets().find((preset) => preset.id === entry.tuningId) ?? getPresets().find((preset) => preset.id === getActiveId());

  async function choose(entry) {
    const preset = matchingPreset(entry);
    if (preset) await onChooseTuning({ tuningId: preset.id, title: entry.title });
  }

  function render() {
    cleanups.forEach((cleanup) => cleanup());
    cleanups = [];
    const isIdeas = category === 'improvisations';
    const kind = isIdeas ? 'improvisation' : 'song';
    const list = library.filter((entry) => entry.kind === kind);

    root.replaceChildren();
    const head = document.createElement('header');
    head.className = 'music-head';
    head.innerHTML = '<h1>Mi música</h1>';
    head.append(icon('Music', 'music-head-icon'));
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'icon-btn'; add.title = 'Añadir'; add.setAttribute('aria-label', 'Añadir a Mi música'); add.append(icon('Plus'));
    add.addEventListener('click', () => onNew(kind));
    head.append(add);

    const switcher = document.createElement('div');
    switcher.className = 'music-switch';
    switcher.setAttribute('role', 'tablist');
    switcher.setAttribute('aria-label', 'Colección');
    ['improvisations', 'songs'].forEach((key) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.role = 'tab';
      button.dataset.category = key;
      button.setAttribute('aria-selected', String(category === key));
      const ideas = key === 'improvisations';
      button.append(icon(ideas ? 'Mic' : 'ListMusic'), document.createTextNode(ideas ? 'Improvisaciones' : 'Canciones'));
      switcher.append(button);
    });

    const section = document.createElement('section');
    section.className = 'music-list';
    section.setAttribute('aria-label', isIdeas ? 'Improvisaciones' : 'Canciones');
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'tab-empty';
      empty.append(icon(isIdeas ? 'Mic' : 'ListMusic', 'tab-empty-icon'));
      const title = document.createElement('h2'); title.textContent = isIdeas ? 'Aún no hay improvisaciones' : 'Aún no hay canciones';
      const text = document.createElement('p'); text.textContent = 'Guarda una idea y vuelve a su afinación en un toque.';
      empty.append(title, text);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-primary'; button.textContent = 'Añadir'; button.addEventListener('click', () => onNew(kind)); empty.append(button); section.append(empty);
    }
    list.forEach((entry) => {
      const preset = matchingPreset(entry);
      const active = preset?.id === getActiveId();
      const item = document.createElement('article');
      item.className = `music-entry${active ? ' active' : ''}`;
      const type = document.createElement('span');
      type.className = 'music-type';
      type.append(icon(isIdeas ? 'Mic' : 'ListMusic'));
      const copy = document.createElement('span');
      copy.className = 'music-entry-copy';
      const date = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' }).format(entry.createdAt ?? Date.now());
      copy.innerHTML = `
        <span class="music-title">${entry.title}</span>
        <span class="music-detail">${isIdeas ? 'Improvisación' : 'Canción'} · ${date}${entry.audioId ? '' : ' · sin audio'}</span>
        <span class="music-tuning">${preset?.name ?? 'Afinación no disponible'}</span>`;
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'music-action';
      action.title = `Afinar para ${entry.title}`;
      action.setAttribute('aria-label', `Afinar para ${entry.title}: ${preset?.name ?? 'afinación no disponible'}`);
      action.append(icon(active ? 'Check' : 'Gauge'));
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'music-edit icon-btn ghost'; edit.title = `Editar ${entry.title}`; edit.setAttribute('aria-label', `Editar ${entry.title}`); edit.append(icon('Pencil'));
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'music-delete icon-btn ghost'; remove.title = `Eliminar ${entry.title}`; remove.setAttribute('aria-label', `Eliminar definitivamente ${entry.title}`); remove.append(icon('Trash2'));
      if (entry.audioId) item.append(type, copy, createWaveformPlayer(entry, cleanups), action);
      else item.append(type, copy, createEmptyAudioPrompt(entry, onRecord), action);
      action.addEventListener('click', () => choose(entry));
      item.append(edit);
      edit.addEventListener('click', () => onEdit(entry));
      item.append(remove);
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try { if (!(await onDelete(entry))) remove.disabled = false; } catch { remove.disabled = false; }
      });
      section.append(item);
    });
    root.append(head, switcher, section);
    switcher.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-category]');
      if (button && button.dataset.category !== category) {
        category = button.dataset.category;
        render();
      }
    });
  }

  async function load() { library = await api.fetchMusic(); render(); }
  return { render, load };
}
