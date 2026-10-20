// Almacenamiento local de afinaciones (src/store.js) y su API (src/api.js), con un localStorage simulado.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, memoryStorage, STORAGE_KEY } from '../src/store.js';
import { DEFAULT_PRESETS } from '../src/presets-shared.js';

const storage = memoryStorage();
storage.removeItem = () => {};
globalThis.localStorage = storage;
let api;

before(async () => {
  api = await import('../src/api.js');
});

test('siembra las afinaciones predefinidas en un almacenamiento vacío', async () => {
  const { presets, activeId } = await api.fetchPresets();
  assert.deepEqual(presets.map((p) => p.id), DEFAULT_PRESETS.map((p) => p.id));
  assert.ok(presets.every((p) => p.isDefault));
  assert.equal(activeId, 'standard');
});

test('crea, edita, activa y elimina una afinación', async () => {
  const created = await api.createPreset({ name: '  Mi afinación  ', strings: [80, 110.004, 146.83, 196, 246.94, 329.63] });
  assert.equal(created.name, 'Mi afinación');
  assert.equal(created.strings[1], 110);
  assert.equal(created.isDefault, false);

  const updated = await api.updatePreset(created.id, { name: 'Renombrada', strings: [81, 110, 146.83, 196, 246.94, 329.63] });
  assert.equal(updated.strings[0], 81);

  await api.setActivePreset(created.id);
  assert.equal((await api.fetchPresets()).activeId, created.id);

  await api.deletePreset(created.id);
  const after = await api.fetchPresets();
  assert.ok(!after.presets.some((p) => p.id === created.id));
  assert.equal(after.activeId, 'standard', 'vuelve a la primera si se borra la activa');
});

test('rechaza datos inválidos', async () => {
  await assert.rejects(api.createPreset({ name: 'X', strings: [10, 110, 146, 196, 246, 329] }), /6ª cuerda/);
  await assert.rejects(api.createPreset({ name: '', strings: [82, 110, 146, 196, 246, 329] }), /nombre/);
  await assert.rejects(api.createPreset({ name: 'X', strings: [82, 110] }), /6 cuerdas/);
  await assert.rejects(api.updatePreset('no-existe', { name: 'X', strings: [82, 110, 146, 196, 246, 329] }), /no encontrada/);
  await assert.rejects(api.setActivePreset('no-existe'), /no encontrada/);
});

test('restaurar repone predefinidas editadas o borradas y conserva las personalizadas', async () => {
  await api.updatePreset('standard', { name: 'Editada', strings: [80, 110, 146.83, 196, 246.94, 329.63] });
  await api.deletePreset('dadgad');
  const custom = await api.createPreset({ name: 'Custom', strings: [82, 110, 146, 196, 246, 329] });

  const { presets } = await api.restoreDefaults();
  const standard = presets.find((p) => p.id === 'standard');
  assert.equal(standard.name, DEFAULT_PRESETS[0].name);
  assert.equal(standard.strings[0], 82.41);
  assert.ok(presets.some((p) => p.id === 'dadgad'));
  assert.equal(presets.at(-1).id, custom.id);
});

test('no permite eliminar la última afinación', async () => {
  const { presets } = await api.fetchPresets();
  for (const p of presets.slice(1)) await api.deletePreset(p.id);
  await assert.rejects(api.deletePreset(presets[0].id), /al menos una/);
});

test('guarda y valida la sensibilidad del micrófono', async () => {
  assert.deepEqual(await api.fetchSettings(), { sensitivityDb: -44.5 });
  assert.equal((await api.updateSettings({ sensitivityDb: -38.27 })).sensitivityDb, -38.3);
  await assert.rejects(api.updateSettings({ sensitivityDb: -5 }), /fuera de rango/);
  await assert.rejects(api.updateSettings({ sensitivityDb: 'x' }), /fuera de rango/);
  assert.equal((await api.fetchSettings()).sensitivityDb, -38.3);
});

test('los datos persisten al reabrir el almacenamiento', () => {
  const store = openStore(storage);
  const custom = store.create({ name: 'Persistente', strings: [70, 100, 140, 190, 240, 320] });
  store.setActiveId(custom.id);
  const reopened = openStore(storage);
  assert.ok(reopened.list().some((p) => p.name === 'Persistente'));
  assert.equal(reopened.getActiveId(), custom.id);
  assert.equal(reopened.getSettings().sensitivityDb, -38.3);
});

test('ignora datos guardados corruptos o inválidos', () => {
  const broken = memoryStorage();
  broken.setItem(STORAGE_KEY, '{no es json');
  assert.equal(openStore(broken).list().length, DEFAULT_PRESETS.length);

  broken.setItem(STORAGE_KEY, JSON.stringify({
    presets: [{ id: 'ok', name: 'Válida', strings: [82, 110, 146, 196, 246, 329] }, { id: 'mala', name: 'X', strings: [1] }],
    activeId: 'mala',
    sensitivityDb: 99,
  }));
  const store = openStore(broken);
  assert.deepEqual(store.list().map((p) => p.id), ['ok']);
  assert.equal(store.getActiveId(), 'ok');
  assert.equal(store.getSettings().sensitivityDb, -44.5);
});
