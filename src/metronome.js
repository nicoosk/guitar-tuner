import { icon } from './icons.js';
import { audioContext, click } from './reference.js';

const IDLE_MS = 10000;
const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;
const MAX_PULSE_MS = 230;
const STORAGE_KEY = 'afinador:metronome';

export function setupMetronome(root, showError) {
  const toggle = root.querySelector('#metronome-toggle');
  const pulse = toggle.querySelector('.metronome-pulse');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const controls = root.querySelector('#metronome-controls');
  const play = root.querySelector('#metronome-play');
  const status = root.querySelector('#metronome-status');
  const fields = [...controls.querySelectorAll('input')];
  let settings = fields.map((field) => field.value);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved)) {
      fields.forEach((field, i) => {
        field.value = saved[i] ?? '';
        if (!field.validity.valid) field.value = settings[i];
      });
      settings = fields.map((field) => field.value);
    }
  } catch {
    // El metrónomo también funciona sin almacenamiento local.
  }

  let idleTimer;
  let audioTimer;
  let frame;
  let animation;
  let ac;
  let nextTime;
  let beat;
  const voices = new Set();
  const visualBeats = [];

  function schedule() {
    const now = ac.currentTime;
    const interval = 60 / Number(settings[2]);
    const beats = Number(settings[0]);
    // Descarta el feedback vencido aunque la pestaña haya dejado de pintar.
    while (visualBeats.length && visualBeats[0].time < now - MAX_PULSE_MS / 1000) visualBeats.shift();
    if (nextTime < now) {
      // Salta los pulsos vencidos si el navegador retrasó el temporizador.
      const missed = Math.ceil((now - nextTime) / interval);
      beat = (beat + missed % beats) % beats;
      nextTime += missed * interval;
    }
    while (nextTime < now + LOOKAHEAD_S) {
      const accent = beat === 0;
      const voice = click(nextTime, accent, Math.min(0.06, interval));
      visualBeats.push({ time: nextTime, accent });
      voices.add(voice);
      voice.onended = () => voices.delete(voice);
      beat = (beat + 1) % beats;
      nextTime += interval;
    }
  }

  function draw() {
    const now = ac.currentTime;
    let current;
    while (visualBeats.length && visualBeats[0].time <= now) current = visualBeats.shift();
    if (current) {
      const { time, accent } = current;
      const intervalMs = 60000 / Number(settings[2]);
      const duration = Math.min(accent ? MAX_PULSE_MS : 140, intervalMs * (accent ? 0.82 : 0.55));
      const elapsed = (now - time) * 1000;
      if (elapsed < duration) {
        animation?.cancel();
        pulse.classList.toggle('is-accent', accent);
        const keyframes = [{ opacity: accent ? 1 : 0.75 }, { opacity: 0 }];
        if (!reducedMotion.matches) {
          keyframes[0].transform = 'scale(1)';
          keyframes[1].transform = accent ? 'scale(1.28)' : 'scale(1.12)';
        }
        animation = pulse.animate(keyframes, { duration, easing: 'ease-out' });
        animation.currentTime = elapsed;
      }
    }
    frame = requestAnimationFrame(draw);
  }

  function clearAudio() {
    clearInterval(audioTimer);
    audioTimer = undefined;
    cancelAnimationFrame(frame);
    animation?.cancel();
    visualBeats.length = 0;
    voices.forEach((voice) => voice.stop());
    voices.clear();
  }

  function startAudio() {
    ac = audioContext();
    nextTime = ac.currentTime + 0.02;
    beat = 0;
    schedule();
    audioTimer = setInterval(schedule, TICK_MS);
    frame = requestAnimationFrame(draw);
  }

  function renderPlaying(playing) {
    root.classList.toggle('is-playing', playing);
    toggle.setAttribute('aria-label', playing ? 'Metrónomo en marcha' : 'Metrónomo');
    const label = playing ? 'Detener metrónomo' : 'Iniciar metrónomo';
    play.setAttribute('aria-label', label);
    play.title = label;
    play.replaceChildren(icon(playing ? 'Square' : 'Play'));
    status.textContent = playing ? 'Metrónomo en marcha' : 'Metrónomo detenido';
  }

  function stop() {
    clearAudio();
    renderPlaying(false);
  }

  function start() {
    try {
      startAudio();
      renderPlaying(true);
    } catch {
      stop();
      status.textContent = 'No se pudo iniciar el audio del metrónomo.';
      showError(status.textContent);
    }
  }

  function commit(field) {
    const index = fields.indexOf(field);
    if (!field.validity.valid) {
      field.reportValidity();
      return;
    }
    if (Number(settings[index]) === field.valueAsNumber) return;
    settings[index] = field.value;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Los cambios siguen activos durante esta sesión.
    }
    if (audioTimer !== undefined) {
      clearAudio();
      start();
    }
  }

  function collapse() {
    clearTimeout(idleTimer);
    if (controls.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    fields.forEach((field, index) => { field.value = settings[index]; });
    controls.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }

  function resetIdle() {
    if (controls.hidden) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(collapse, IDLE_MS);
  }

  toggle.addEventListener('click', () => {
    if (!controls.hidden) {
      collapse();
      return;
    }
    controls.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    resetIdle();
  });

  fields.forEach((field) => {
    field.addEventListener('change', () => commit(field));
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(field);
      }
    });
  });

  play.addEventListener('click', () => {
    if (audioTimer !== undefined) {
      stop();
      return;
    }
    for (const field of fields) {
      if (!field.reportValidity()) return;
      commit(field);
    }
    start();
  });

  for (const event of ['pointerdown', 'pointermove', 'input', 'keydown', 'focusin']) {
    root.addEventListener(event, resetIdle);
  }
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !controls.hidden) {
      event.preventDefault();
      collapse();
    }
  });

  // Un diálogo modal vuelve inerte el resto del documento. Mueve el mismo
  // control a la hoja activa para conservar su estado y mantenerlo accesible.
  const dialogs = [...document.querySelectorAll('dialog.sheet')];
  const observer = new MutationObserver(() => {
    const host = dialogs.findLast((dialog) => dialog.matches(':modal')) ?? document.body;
    if (root.parentElement !== host) host.append(root);
  });
  dialogs.forEach((dialog) => observer.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
  window.addEventListener('pagehide', stop);
}
