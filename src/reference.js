// Síntesis de cuerda pulsada con armónicos y decaimiento (sin muestras de audio).
// La usan el tono de referencia del afinador y el reproductor de tablaturas.

const DURATION_S = 2.5;
const HARMONICS = [1, 0.55, 0.35, 0.22, 0.14, 0.09, 0.06, 0.04];
const CLICK_DURATION_S = 0.06;

let ctx = null;
let wave = null;
let current = null;
const clickBuffers = new Map();

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

/** Modela un golpe de madera: impacto breve seguido de resonancias inarmónicas. */
function woodClick(ac, accent) {
  const rate = ac.sampleRate;
  const buffer = ac.createBuffer(1, Math.ceil(rate * CLICK_DURATION_S), rate);
  const samples = buffer.getChannelData(0);
  const base = accent ? 1050 : 780;
  const volume = accent ? 0.27 : 0.17;
  let noise = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const t = i / rate;
    const phase = 2 * Math.PI * base * t;
    noise += 0.35 * (2 * Math.random() - 1 - noise);
    const impact = noise * Math.exp(-t / 0.0018);
    const body = 0.62 * Math.sin(phase) * Math.exp(-t / 0.009);
    const overtones = (0.28 * Math.sin(2.41 * phase) + 0.12 * Math.sin(3.73 * phase)) * Math.exp(-t / 0.004);
    const attack = Math.min(1, t / 0.0005);
    const tail = Math.min(1, (samples.length - 1 - i) / (rate * 0.005));
    samples[i] = volume * (impact + body + overtones) * attack * tail;
  }
  return buffer;
}

/** Clic de metrónomo en `when`; `accent` marca el primer tiempo del compás. */
export function click(when, accent = false, duration = CLICK_DURATION_S) {
  const ac = audioContext();
  if (!clickBuffers.has(accent)) clickBuffers.set(accent, woodClick(ac, accent));
  const source = ac.createBufferSource();
  source.buffer = clickBuffers.get(accent);
  if (duration < CLICK_DURATION_S) {
    const gain = ac.createGain();
    gain.gain.setValueAtTime(1, when + duration * 0.75);
    gain.gain.linearRampToValueAtTime(0, when + duration);
    source.connect(gain).connect(ac.destination);
  } else {
    source.connect(ac.destination);
  }
  source.start(when, 0, duration);
  return source;
}

/**
 * Aviso breve de cuerda afinada: dos notas agudas (sobre el rango que analiza el micrófono,
 * para que el afinador no las tome por la guitarra).
 */
export function chime() {
  const ac = audioContext();
  const start = ac.currentTime + 0.01;
  [2093, 2637].forEach((freq, i) => {
    const when = start + i * 0.09;
    const osc = new OscillatorNode(ac, { type: 'sine', frequency: freq });
    const gain = new GainNode(ac, { gain: 0 });
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.08, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0005, when + 0.35);
    osc.connect(gain).connect(ac.destination);
    osc.start(when);
    osc.stop(when + 0.4);
  });
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
