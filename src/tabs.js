// Tablaturas: modelo, validación y cálculos de reproducción (sin DOM ni audio), testeables en Node.
//
// Cada tablatura: { id, name, bpm, measures, beatsPerMeasure, subdivision, notes }
//   - La grilla tiene measures × beatsPerMeasure × subdivision pasos (columnas).
//   - subdivision = pasos por tiempo: 1 negras, 2 corcheas, 3 tresillos, 4 semicorcheas.
//   - notes: [[paso, cuerda, traste], …]; cuerda = índice como en las afinaciones (0 = 6ª … 5 = 1ª).

import { STRING_COUNT } from './tuning.js';

export const MAX_FRET = 24;
export const BPM_MIN = 30;
export const BPM_MAX = 300;
export const MEASURES_MIN = 1;
export const MEASURES_MAX = 64;
export const BEATS_MIN = 1;
export const BEATS_MAX = 12;
export const SUBDIVISIONS = [
  { value: 1, label: 'Negras' },
  { value: 2, label: 'Corcheas' },
  { value: 3, label: 'Tresillos' },
  { value: 4, label: 'Semicorcheas' },
];
export const MAX_TAB_NAME_LENGTH = 40;

export const DEFAULT_TAB = { bpm: 90, measures: 4, beatsPerMeasure: 4, subdivision: 2 };

export const stepsPerMeasure = (tab) => tab.beatsPerMeasure * tab.subdivision;
export const stepCount = (tab) => tab.measures * stepsPerMeasure(tab);

/** Duración de un paso en segundos. */
export const stepSeconds = (tab) => 60 / tab.bpm / tab.subdivision;

/** Frecuencia de `fret` sobre una cuerda al aire de `openHz` (temperamento igual). */
export const fretFrequency = (openHz, fret) => openHz * 2 ** (fret / 12);

const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

/**
 * Valida y normaliza una tablatura recibida del usuario.
 * Las notas fuera de rango o más allá del largo se descartan (al acortar se pierden las del final).
 * Devuelve { value } o { error } con un mensaje legible.
 */
export function validateTab(input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name) return { error: 'La tablatura necesita un nombre.' };
  if (name.length > MAX_TAB_NAME_LENGTH) return { error: `El nombre admite hasta ${MAX_TAB_NAME_LENGTH} caracteres.` };

  const bpm = Math.round(Number(input.bpm));
  if (!isInt(bpm, BPM_MIN, BPM_MAX)) return { error: `El tempo debe estar entre ${BPM_MIN} y ${BPM_MAX} BPM.` };
  const measures = Number(input.measures);
  if (!isInt(measures, MEASURES_MIN, MEASURES_MAX)) return { error: `El largo debe ser de ${MEASURES_MIN} a ${MEASURES_MAX} compases.` };
  const beatsPerMeasure = Number(input.beatsPerMeasure);
  if (!isInt(beatsPerMeasure, BEATS_MIN, BEATS_MAX)) return { error: `El compás admite de ${BEATS_MIN} a ${BEATS_MAX} tiempos.` };
  const subdivision = Number(input.subdivision);
  if (!SUBDIVISIONS.some((s) => s.value === subdivision)) return { error: 'Subdivisión no válida.' };

  const total = measures * beatsPerMeasure * subdivision;
  const byCell = new Map();
  for (const note of Array.isArray(input.notes) ? input.notes : []) {
    const [step, string, fret] = Array.isArray(note) ? note.map(Number) : [];
    if (isInt(step, 0, total - 1) && isInt(string, 0, STRING_COUNT - 1) && isInt(fret, 0, MAX_FRET)) {
      byCell.set(`${step}:${string}`, [step, string, fret]);
    }
  }
  const notes = [...byCell.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { value: { name, bpm, measures, beatsPerMeasure, subdivision, notes } };
}

/**
 * Adapta las notas a un nuevo largo/compás/subdivisión conservando su posición en el tiempo
 * (en tiempos desde el inicio). Devuelve { notes, dropped, moved }:
 *   dropped = notas que quedan fuera del nuevo largo; moved = notas que caen entre dos pasos
 *   de la nueva subdivisión y se mueven al más cercano (si chocan, gana la última).
 */
export function resizeNotes(tab, { measures, beatsPerMeasure, subdivision }) {
  const total = measures * beatsPerMeasure * subdivision;
  const byCell = new Map();
  let dropped = 0;
  let moved = 0;
  for (const [step, string, fret] of tab.notes) {
    const exact = (step * subdivision) / tab.subdivision;
    if (exact >= total) {
      dropped += 1;
      continue;
    }
    const newStep = Math.min(Math.round(exact), total - 1);
    if (newStep !== exact) moved += 1;
    byCell.set(`${newStep}:${string}`, [newStep, string, fret]);
  }
  const notes = [...byCell.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { notes, dropped, moved };
}

/** Tablatura de ejemplo: escala de Do mayor subiendo y bajando (5ª, 4ª y 3ª cuerda). */
export function exampleTab() {
  const up = [[1, 3], [1, 5], [2, 2], [2, 3], [2, 5], [3, 2], [3, 4], [3, 5]];
  const down = up.slice(0, -1).reverse();
  const notes = [...up, ...down].map(([string, fret], step) => [step, string, fret]);
  return { name: 'Ejemplo · Escala de Do', bpm: 80, measures: 2, beatsPerMeasure: 4, subdivision: 2, notes };
}

/**
 * Agrupa las notas por paso para reproducirlas. Cada nota incluye cuántos pasos suena:
 * hasta la siguiente nota en la misma cuerda (como en una guitarra real) o null si no hay otra.
 * Devuelve un arreglo de largo stepCount(tab); cada elemento es la lista de notas de ese paso.
 */
export function buildTimeline(tab) {
  const timeline = Array.from({ length: stepCount(tab) }, () => []);
  const lastOnString = new Array(STRING_COUNT).fill(null);
  for (const [step, string, fret] of tab.notes) {
    const event = { string, fret, ringSteps: null };
    const previous = lastOnString[string];
    if (previous) previous.ringSteps = step - previous.step;
    lastOnString[string] = Object.assign(event, { step });
    timeline[step]?.push(event);
  }
  return timeline;
}
