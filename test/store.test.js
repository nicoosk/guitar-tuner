// Almacenamiento local de afinaciones, tablaturas y ajustes (src/store.js) y su API (src/api.js), con un localStorage simulado.

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

test('las predefinidas son de solo lectura', async () => {
  const strings = [80, 110, 146.83, 196, 246.94, 329.63];
  await assert.rejects(api.updatePreset('standard', { name: 'Editada', strings }), /predefinidas/);
  await assert.rejects(api.deletePreset('dadgad'), /predefinidas/);
  const { presets } = await api.fetchPresets();
  assert.equal(presets.find((p) => p.id === 'standard').strings[0], 82.41);
  assert.ok(presets.some((p) => p.id === 'dadgad'));
});

test('migra una predefinida editada antes a una personalizada y la mantiene activa', () => {
  const legacy = memoryStorage();
  legacy.setItem(STORAGE_KEY, JSON.stringify({
    presets: [
      { id: 'standard', name: 'Estándar (E A D G B E)', isDefault: true, strings: [80, 110, 146.83, 196, 246.94, 329.63] },
      { id: 'drop-d', name: 'Drop D (D A D G B E)', isDefault: true, strings: [73.42, 110, 146.83, 196, 246.94, 329.63] },
    ],
    activeId: 'standard',
  }));
  const store = openStore(legacy);
  const list = store.list();
  assert.deepEqual(list.slice(0, DEFAULT_PRESETS.length).map((p) => p.id), DEFAULT_PRESETS.map((p) => p.id), 'las predefinidas vuelven completas');
  assert.equal(list.find((p) => p.id === 'standard').strings[0], 82.41);
  const migrated = list.at(-1);
  assert.equal(migrated.name, 'Estándar (editada)');
  assert.equal(migrated.isDefault, false);
  assert.equal(migrated.strings[0], 80);
  assert.equal(list.length, DEFAULT_PRESETS.length + 1, 'una predefinida sin cambios no se duplica');
  assert.equal(store.getActiveId(), migrated.id);
});

test('guarda y valida la sensibilidad del micrófono', async () => {
  assert.deepEqual(await api.fetchSettings(), { sensitivityDb: -44.5, chime: true, view: 'tuner' });
  assert.equal((await api.updateSettings({ sensitivityDb: -38.27 })).sensitivityDb, -38.3);
  await assert.rejects(api.updateSettings({ sensitivityDb: -5 }), /fuera de rango/);
  await assert.rejects(api.updateSettings({ sensitivityDb: 'x' }), /fuera de rango/);
  assert.equal((await api.fetchSettings()).sensitivityDb, -38.3);
});

test('guarda el modo (afinador / tablaturas) sin tocar la sensibilidad', async () => {
  assert.deepEqual(await api.updateSettings({ view: 'tabs' }), { sensitivityDb: -38.3, chime: true, view: 'tabs' });
  assert.equal((await api.updateSettings({ chime: false })).chime, false);
  await assert.rejects(api.updateSettings({ chime: 'sí' }), /sonido/);
  await assert.rejects(api.updateSettings({ view: 'otro' }), /Vista no válida/);
  assert.equal((await api.fetchSettings()).view, 'tabs');
});

test('crea, edita, activa y elimina tablaturas', async () => {
  assert.deepEqual(await api.fetchTabs(), { tabs: [], activeTabId: null });

  const first = await api.createTab({ name: ' Riff ', bpm: 100, measures: 2, beatsPerMeasure: 4, subdivision: 2, notes: [[3, 5, 7], [0, 0, 3]] });
  assert.equal(first.name, 'Riff');
  assert.deepEqual(first.notes, [[0, 0, 3], [3, 5, 7]], 'ordenadas por paso');
  const second = await api.createTab({ name: 'Otra', bpm: 60, measures: 1, beatsPerMeasure: 3, subdivision: 1, notes: [] });
  assert.equal((await api.fetchTabs()).activeTabId, second.id, 'la recién creada queda activa');

  await api.setActiveTab(first.id);
  const updated = await api.updateTab(first.id, { ...first, bpm: 120, notes: [...first.notes, [15, 2, 12]] });
  assert.equal(updated.bpm, 120);
  assert.equal(updated.notes.length, 3);

  await assert.rejects(api.updateTab(first.id, { ...first, bpm: 500 }), /tempo/);
  await assert.rejects(api.updateTab('no-existe', first), /no encontrada/);
  await assert.rejects(api.setActiveTab('no-existe'), /no encontrada/);

  const afterDelete = await api.deleteTab(first.id);
  assert.deepEqual(afterDelete.tabs.map((t) => t.id), [second.id]);
  assert.equal(afterDelete.activeTabId, second.id, 'si se borra la activa, pasa a la primera');
});

test('los datos persisten al reabrir el almacenamiento', () => {
  const store = openStore(storage);
  const custom = store.create({ name: 'Persistente', strings: [70, 100, 140, 190, 240, 320] });
  store.setActiveId(custom.id);
  const reopened = openStore(storage);
  assert.ok(reopened.list().some((p) => p.name === 'Persistente'));
  assert.equal(reopened.getActiveId(), custom.id);
  assert.equal(reopened.getSettings().sensitivityDb, -38.3);
  assert.equal(reopened.getSettings().view, 'tabs');
  assert.deepEqual(reopened.listTabs().map((t) => t.name), ['Otra']);
});

test('ignora datos guardados corruptos o inválidos', () => {
  const broken = memoryStorage();
  broken.setItem(STORAGE_KEY, '{no es json');
  assert.equal(openStore(broken).list().length, DEFAULT_PRESETS.length);

  broken.setItem(STORAGE_KEY, JSON.stringify({
    presets: [{ id: 'ok', name: 'Válida', strings: [82, 110, 146, 196, 246, 329] }, { id: 'mala', name: 'X', strings: [1] }],
    activeId: 'mala',
    sensitivityDb: 99,
    view: 'otra',
    tabs: [{ id: 't1', name: 'Ok', bpm: 90, measures: 1, beatsPerMeasure: 4, subdivision: 2, notes: [[0, 0, 3], [99, 0, 1], [1, 9, 1], [2, 0, 30]] }, { id: 't2', name: 'Mala', bpm: 0 }],
  }));
  const store = openStore(broken);
  assert.deepEqual(store.list().map((p) => p.id), [...DEFAULT_PRESETS.map((p) => p.id), 'ok']);
  assert.equal(store.getActiveId(), 'standard', 'si la activa guardada no existe, vuelve a la primera');
  assert.equal(store.getSettings().sensitivityDb, -44.5);
  assert.equal(store.getSettings().view, 'tuner');
  assert.deepEqual(store.listTabs().map((t) => [t.id, t.notes]), [['t1', [[0, 0, 3]]]], 'descarta notas fuera de rango y tablaturas inválidas');
});
