// Detección con señales sintéticas tipo cuerda (fundamental + armónicos con decaimiento).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PitchDetector } from 'pitchy';
import { centsBetween, nearestString, noteFromFrequency } from '../src/tuning.js';
import { DEFAULT_PRESETS } from '../src/presets-shared.js';

const SAMPLE_RATE = 48000;
const SIZE = 4096;
const detector = PitchDetector.forFloat32Array(SIZE);

function pluckedString(freq, { noise = 0.02 } = {}) {
  const harmonics = [1, 0.7, 0.45, 0.3, 0.2, 0.12];
  const buf = new Float32Array(SIZE);
  const phases = harmonics.map((_, i) => (i * 1.7) % (2 * Math.PI));
  for (let n = 0; n < SIZE; n++) {
    const t = n / SAMPLE_RATE;
    let v = 0;
    harmonics.forEach((a, h) => (v += a * Math.sin(2 * Math.PI * freq * (h + 1) * t + phases[h])));
    buf[n] = 0.2 * v + noise * (Math.random() * 2 - 1);
  }
  return buf;
}

for (const preset of DEFAULT_PRESETS) {
  test(`detecta cada cuerda de "${preset.name}"`, () => {
    preset.strings.forEach((hz, i) => {
      const [pitch, clarity] = detector.findPitch(pluckedString(hz), SAMPLE_RATE);
      assert.ok(clarity > 0.9, `claridad baja (${clarity.toFixed(2)}) en ${hz} Hz`);
      assert.ok(Math.abs(centsBetween(pitch, hz)) < 2, `${pitch.toFixed(2)} Hz detectado para ${hz} Hz`);
      assert.equal(nearestString(pitch, preset.strings).index, i);
    });
  });
}

test('reporta el desvío de una cuerda desafinada', () => {
  const target = 110; // 5ª en estándar
  const detuned = target * 2 ** (-20 / 1200); // 20 cents abajo
  const [pitch] = detector.findPitch(pluckedString(detuned), SAMPLE_RATE);
  const { index, cents } = nearestString(pitch, DEFAULT_PRESETS[0].strings);
  assert.equal(index, 1);
  assert.ok(Math.abs(cents + 20) < 2, `desvío ${cents.toFixed(1)} ¢`);
});

test('nombra notas correctamente', () => {
  assert.equal(noteFromFrequency(82.41).label, 'E2');
  assert.equal(noteFromFrequency(440).label, 'A4');
  assert.equal(noteFromFrequency(185).label, 'F#3');
  assert.ok(Math.abs(noteFromFrequency(445).cents - 19.56) < 0.1);
});
