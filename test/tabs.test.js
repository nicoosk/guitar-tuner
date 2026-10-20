// Modelo de tablaturas (src/tabs.js): validación, cálculo de frecuencias y línea de tiempo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, exampleTab, fretFrequency, resizeNotes, stepCount, stepSeconds, validateTab } from '../src/tabs.js';
import { DEFAULT_PRESETS } from '../src/presets-shared.js';
import { noteFromFrequency } from '../src/tuning.js';

const base = { name: 'T', bpm: 120, measures: 2, beatsPerMeasure: 4, subdivision: 2, notes: [] };

test('el traste sube un semitono por traste según la afinación de la cuerda', () => {
  const standard = DEFAULT_PRESETS[0].strings;
  assert.equal(noteFromFrequency(fretFrequency(standard[0], 0)).label, 'E2');
  assert.equal(noteFromFrequency(fretFrequency(standard[0], 5)).label, 'A2');
  assert.equal(noteFromFrequency(fretFrequency(standard[5], 12)).label, 'E5');
  const dropD = DEFAULT_PRESETS[1].strings;
  assert.equal(noteFromFrequency(fretFrequency(dropD[0], 2)).label, 'E2', 'en Drop D la 6ª al traste 2 es Mi');
});

test('largo y duración de cada paso salen del compás, la subdivisión y el BPM', () => {
  assert.equal(stepCount(base), 16);
  assert.equal(stepSeconds(base), 0.25); // corcheas a 120 BPM
  assert.equal(stepSeconds({ ...base, bpm: 60, subdivision: 4 }), 0.25);
});

test('validateTab normaliza y rechaza valores fuera de rango', () => {
  const { value } = validateTab({ ...base, bpm: '90.4', notes: [[1, 0, 3], [1, 0, 5], [16, 0, 1], [0, 6, 1], [0, 0, 25], [0, 2, 0]] });
  assert.equal(value.bpm, 90);
  assert.deepEqual(value.notes, [[0, 2, 0], [1, 0, 5]], 'última nota por celda, sin fuera de rango, ordenadas');
  assert.match(validateTab({ ...base, name: ' ' }).error, /nombre/);
  assert.match(validateTab({ ...base, bpm: 10 }).error, /tempo/);
  assert.match(validateTab({ ...base, measures: 0 }).error, /largo/);
  assert.match(validateTab({ ...base, beatsPerMeasure: 13 }).error, /tiempos/);
  assert.match(validateTab({ ...base, subdivision: 5 }).error, /Subdivisión/);
});

test('cada nota suena hasta la siguiente en su misma cuerda', () => {
  const tab = { ...base, notes: [[0, 0, 3], [0, 5, 0], [2, 0, 5], [7, 5, 3]] };
  const timeline = buildTimeline(tab);
  assert.equal(timeline.length, 16);
  assert.deepEqual(timeline[0].map((n) => [n.string, n.fret, n.ringSteps]), [[0, 3, 2], [5, 0, 7]]);
  assert.deepEqual(timeline[2].map((n) => n.ringSteps), [null], 'la última de su cuerda no tiene siguiente');
  assert.deepEqual(timeline[1], []);
});

test('resizeNotes conserva la posición en el tiempo al cambiar subdivisión o largo', () => {
  const tab = { ...base, notes: [[0, 0, 1], [3, 1, 2], [15, 2, 3]] };
  const finer = resizeNotes(tab, { measures: 2, beatsPerMeasure: 4, subdivision: 4 });
  assert.deepEqual(finer.notes, [[0, 0, 1], [6, 1, 2], [30, 2, 3]]);
  assert.equal(finer.moved + finer.dropped, 0);

  const coarser = resizeNotes(tab, { measures: 2, beatsPerMeasure: 4, subdivision: 1 });
  assert.equal(coarser.moved, 2, 'las corcheas impares caen entre negras');

  const shorter = resizeNotes(tab, { measures: 1, beatsPerMeasure: 4, subdivision: 2 });
  assert.equal(shorter.dropped, 1);
  assert.deepEqual(shorter.notes, [[0, 0, 1], [3, 1, 2]]);
});

test('la tablatura de ejemplo es válida', () => {
  const { value, error } = validateTab(exampleTab());
  assert.equal(error, undefined);
  assert.equal(value.notes.length, 15);
});
