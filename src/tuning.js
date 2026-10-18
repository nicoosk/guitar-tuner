// Utilidades musicales puras (sin DOM ni audio), testeables en Node.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const A4 = 440;

export const STRING_COUNT = 6;

/** Diferencia en cents de `freq` respecto a `ref` (100 cents = 1 semitono). */
export function centsBetween(freq, ref) {
  return 1200 * Math.log2(freq / ref);
}

/** Nota temperada más cercana a una frecuencia, con su desvío en cents. */
export function noteFromFrequency(freq) {
  const midi = Math.round(69 + 12 * Math.log2(freq / A4));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const exact = A4 * 2 ** ((midi - 69) / 12);
  return { name, octave, label: `${name}${octave}`, midi, cents: centsBetween(freq, exact) };
}

/**
 * Cuerda cuya frecuencia objetivo está más cerca (en cents) de `freq`.
 * `strings` va ordenado de la 6ª (grave) a la 1ª (aguda).
 */
export function nearestString(freq, strings) {
  let index = -1;
  let cents = Infinity;
  strings.forEach((hz, i) => {
    const c = centsBetween(freq, hz);
    if (Math.abs(c) < Math.abs(cents)) {
      index = i;
      cents = c;
    }
  });
  return { index, cents };
}

/** Índice del arreglo (0 = 6ª cuerda) → número de cuerda (6..1). */
export function stringNumber(index) {
  return STRING_COUNT - index;
}

/** dBFS → amplitud lineal (RMS). */
export const dbToAmplitude = (db) => 10 ** (db / 20);

/** Amplitud lineal (RMS) → dBFS. */
export const amplitudeToDb = (amplitude) => (amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity);

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
