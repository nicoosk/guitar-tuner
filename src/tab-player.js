// Reproductor de tablaturas: programa las notas con anticipación sobre el reloj del AudioContext
// (patrón "lookahead"), así el ritmo es exacto aunque el hilo principal se demore.

import { audioContext, click, pluck } from './reference.js';
import { buildTimeline, fretFrequency, stepCount, stepSeconds, stepsPerMeasure } from './tabs.js';

const LOOKAHEAD_S = 0.12; // cuánto adelante se programa
const TICK_MS = 25; // cada cuánto se revisa
const MAX_RING_S = 2.5;
const VOICE_VOLUME = 0.28; // más bajo que el tono de referencia: pueden sonar 6 cuerdas a la vez

export class TabPlayer {
  /**
   * @param {object} options
   * @param {() => object} options.getTab        tablatura actual (se relee en cada paso: cambios en vivo)
   * @param {() => number[]} options.getStrings  Hz de las cuerdas al aire según la afinación activa
   * @param {(step: number | null) => void} options.onStep  paso que está sonando (null al detenerse)
   */
  constructor({ getTab, getStrings, onStep }) {
    Object.assign(this, { getTab, getStrings, onStep });
    this.playing = false;
    this.loop = false;
    this.metronome = false;
    this.voices = [];
    this.queue = []; // { step, time } programados y aún no mostrados
  }

  start(fromStep = 0) {
    this.stop();
    const ac = audioContext();
    this.playing = true;
    this.step = fromStep;
    this.nextTime = ac.currentTime + 0.08;
    this.timeline = buildTimeline(this.getTab());
    this.timer = setInterval(this.schedule, TICK_MS);
    this.schedule();
    this.frame = requestAnimationFrame(this.draw);
  }

  /** Detiene la reproducción; con `cut` se apagan también las notas que siguen sonando. */
  stop({ cut = true } = {}) {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.frame);
    if (cut) this.voices.forEach((v) => v.note.stop());
    this.voices = [];
    this.queue = [];
    this.onStep(null);
  }

  /** La tablatura cambió (nota o ajustes): se recalcula para los próximos pasos. */
  refresh() {
    if (this.playing) this.timeline = buildTimeline(this.getTab());
  }

  schedule = () => {
    const ac = audioContext();
    while (this.playing && this.nextTime < ac.currentTime + LOOKAHEAD_S) {
      const tab = this.getTab();
      const total = stepCount(tab);
      if (this.step >= total) {
        if (!this.loop) {
          // Al llegar al final se deja terminar el último paso y que las notas se apaguen solas.
          const endAt = this.nextTime;
          clearInterval(this.timer);
          this.timer = setTimeout(() => this.stop({ cut: false }), Math.max(0, (endAt - ac.currentTime) * 1000));
          return;
        }
        this.step = 0;
      }
      this.playStep(tab, this.step, this.nextTime);
      this.queue.push({ step: this.step, time: this.nextTime });
      this.nextTime += stepSeconds(tab);
      this.step += 1;
    }
  };

  playStep(tab, step, time) {
    const perBeat = tab.subdivision;
    if (this.metronome && step % perBeat === 0) click(time, step % stepsPerMeasure(tab) === 0);

    const strings = this.getStrings();
    const seconds = stepSeconds(tab);
    // Cada nota suena hasta la siguiente en su misma cuerda (ringSteps), como en una guitarra.
    for (const { string, fret, ringSteps } of this.timeline[step] ?? []) {
      const duration = Math.min(ringSteps ? ringSteps * seconds : MAX_RING_S, MAX_RING_S);
      const note = pluck(fretFrequency(strings[string], fret), time, { duration, volume: VOICE_VOLUME });
      this.voices.push({ note, end: time + duration });
    }
    this.voices = this.voices.filter((v) => v.end > time - 0.5);
  }

  draw = () => {
    const now = audioContext().currentTime;
    let current = null;
    while (this.queue.length && this.queue[0].time <= now) current = this.queue.shift().step;
    if (current !== null) this.onStep(current);
    if (this.playing) this.frame = requestAnimationFrame(this.draw);
  };
}
