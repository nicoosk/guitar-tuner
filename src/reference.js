// Síntesis de cuerda pulsada con armónicos y decaimiento (sin muestras de audio).
// La usan el tono de referencia del afinador y el reproductor de tablaturas.

const DURATION_S = 2.5;
const HARMONICS = [1, 0.55, 0.35, 0.22, 0.14, 0.09, 0.06, 0.04];

let ctx = null;
let wave = null;
let current = null;

/** AudioContext compartido; se crea y reanuda en el primer uso (debe ser tras un gesto del usuario). */
export function audioContext() {
  ctx ??= new AudioContext();
  if (ctx.state !== 'running') ctx.resume();
  return ctx;
}

/**
 * Programa una nota pulsada de `freq` Hz en el instante `when` (tiempo del AudioContext).
 * Suena hasta `duration` segundos (máx. 2,5) con un apagado breve al final.
 * Devuelve { osc, stop() } para cortarla antes.
 */
export function pluck(freq, when, { duration = DURATION_S, volume = 0.5 } = {}) {
  const ac = audioContext();
  wave ??= ac.createPeriodicWave(new Float32Array(HARMONICS.length + 1), Float32Array.from([0, ...HARMONICS]));
  const length = Math.min(duration, DURATION_S);
  const end = when + length;

  const osc = new OscillatorNode(ac, { frequency: freq, periodicWave: wave });
  // El filtro se va cerrando para imitar cómo la cuerda pierde brillo al apagarse.
  const filter = new BiquadFilterNode(ac, { type: 'lowpass', Q: 0.7 });
  filter.frequency.setValueAtTime(Math.min(freq * 12, 8000), when);
  filter.frequency.exponentialRampToValueAtTime(Math.max(freq * 2, 300), when + DURATION_S);
  const gain = new GainNode(ac, { gain: 0 });
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(volume, when + 0.005);
  if (length < DURATION_S) {
    // Sigue la misma curva de decaimiento hasta poco antes del corte y luego se apaga rápido.
    const cut = Math.max(0.01, length - 0.03);
    gain.gain.exponentialRampToValueAtTime(volume * (0.001 / volume) ** (cut / DURATION_S), when + cut);
    gain.gain.linearRampToValueAtTime(0, end);
  } else {
    gain.gain.exponentialRampToValueAtTime(0.001, end);
  }

  osc.connect(filter).connect(gain).connect(ac.destination);
  osc.start(when);
  osc.stop(end + 0.1);

  const stop = () => {
    const now = ac.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, 0.02);
    try {
      osc.stop(now + 0.1);
    } catch {
      // ya estaba detenido
    }
  };
  return { osc, stop };
}

/** Clic de metrónomo en `when`; `accent` marca el primer tiempo del compás. */
export function click(when, accent = false) {
  const ac = audioContext();
  const osc = new OscillatorNode(ac, { type: 'square', frequency: accent ? 1760 : 1175 });
  const gain = new GainNode(ac, { gain: 0 });
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(accent ? 0.16 : 0.09, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
  osc.connect(gain).connect(ac.destination);
  osc.start(when);
  osc.stop(when + 0.06);
}

/** Reproduce `freq` Hz; `onEnd` se llama cuando el tono termina solo (no al detenerlo). */
export function playReference(freq, onEnd) {
  stopReference();
  const note = pluck(freq, audioContext().currentTime);
  current = note;
  note.osc.onended = () => {
    if (current !== note) return;
    current = null;
    onEnd?.();
  };
}

export function stopReference() {
  if (!current) return;
  const note = current;
  current = null;
  note.stop();
}
