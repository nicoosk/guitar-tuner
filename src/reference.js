// Tono de referencia: cuerda pulsada sintetizada con armónicos y decaimiento.
// El oscilador suena exactamente a la frecuencia objetivo (sin muestras de audio).

const DURATION_S = 2.5;
const HARMONICS = [1, 0.55, 0.35, 0.22, 0.14, 0.09, 0.06, 0.04];

let ctx = null;
let wave = null;
let current = null;

/** Reproduce `freq` Hz; `onEnd` se llama cuando el tono termina solo (no al detenerlo). */
export function playReference(freq, onEnd) {
  ctx ??= new AudioContext();
  ctx.resume();
  stopReference();
  wave ??= ctx.createPeriodicWave(new Float32Array(HARMONICS.length + 1), Float32Array.from([0, ...HARMONICS]));

  const now = ctx.currentTime;
  const osc = new OscillatorNode(ctx, { frequency: freq, periodicWave: wave });
  // El filtro se va cerrando para imitar cómo la cuerda pierde brillo al apagarse.
  const filter = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.7 });
  filter.frequency.setValueAtTime(Math.min(freq * 12, 8000), now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(freq * 2, 300), now + DURATION_S);
  const gain = new GainNode(ctx, { gain: 0 });
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.5, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + DURATION_S);

  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + DURATION_S);
  current = { osc, gain };
  osc.onended = () => {
    if (current?.osc !== osc) return;
    current = null;
    onEnd?.();
  };
}

export function stopReference() {
  if (!current) return;
  const { osc, gain } = current;
  current = null;
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setTargetAtTime(0, now, 0.02);
  osc.stop(now + 0.1);
}
