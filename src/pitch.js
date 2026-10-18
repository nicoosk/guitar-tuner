// Captura del micrófono y detección de frecuencia (algoritmo McLeod vía pitchy).

import { PitchDetector } from 'pitchy';
import { dbToAmplitude, median } from './tuning.js';
import { DEFAULT_SENSITIVITY_DB } from './presets-shared.js';

const FFT_SIZE = 4096; // ~85 ms a 48 kHz: varios periodos incluso para un D2 (73 Hz)
const MIN_CLARITY = 0.9; // confianza mínima del detector (0..1)
const MIN_FREQ = 50;
const MAX_FREQ = 1500;
const HISTORY_SIZE = 5; // mediana de las últimas lecturas para descartar saltos

export class Tuner {
  /** @param {(freq: number | null, level: number) => void} onReading  level = RMS de la señal */
  constructor(onReading) {
    this.onReading = onReading;
    this.history = [];
    this.frame = null;
    this.level = 0;
    this.minRms = dbToAmplitude(DEFAULT_SENSITIVITY_DB); // bajo este volumen se ignora (ruido de fondo)
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const source = this.ctx.createMediaStreamSource(this.stream);
    const highpass = new BiquadFilterNode(this.ctx, { type: 'highpass', frequency: 40 });
    const lowpass = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 1800 });
    this.analyser = new AnalyserNode(this.ctx, { fftSize: FFT_SIZE });
    source.connect(highpass).connect(lowpass).connect(this.analyser);

    this.buffer = new Float32Array(this.analyser.fftSize);
    this.detector = PitchDetector.forFloat32Array(this.analyser.fftSize);
    this.loop();
  }

  loop = () => {
    this.analyser.getFloatTimeDomainData(this.buffer);
    const freq = this.detect();
    this.onReading(freq, this.level);
    this.frame = requestAnimationFrame(this.loop);
  };

  detect() {
    let sum = 0;
    for (const s of this.buffer) sum += s * s;
    this.level = Math.sqrt(sum / this.buffer.length);
    if (this.level < this.minRms) {
      this.history = [];
      return null;
    }

    const [pitch, clarity] = this.detector.findPitch(this.buffer, this.ctx.sampleRate);
    if (clarity < MIN_CLARITY || pitch < MIN_FREQ || pitch > MAX_FREQ) return null;

    this.history.push(pitch);
    if (this.history.length > HISTORY_SIZE) this.history.shift();
    return median(this.history);
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
  }
}
