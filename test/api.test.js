// API + SQLite sobre una base temporal en disco (verifica persistencia entre aperturas).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';
import { createApiMiddleware } from '../server/api.js';
import { DEFAULT_PRESETS } from '../src/presets-shared.js';

const dir = mkdtempSync(join(tmpdir(), 'afinador-test-'));
const dbFile = join(dir, 'afinador.db');
let store, server, base;

before(async () => {
  store = openDatabase(dbFile);
  server = createServer(createApiMiddleware(store));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

test('siembra las afinaciones predefinidas en una base nueva', async () => {
  const { status, body } = await call('GET', '/api/presets');
  assert.equal(status, 200);
  assert.deepEqual(body.presets.map((p) => p.id), DEFAULT_PRESETS.map((p) => p.id));
  assert.equal(body.activeId, 'standard');
});

test('crea, edita, activa y elimina una afinación', async () => {
  const created = await call('POST', '/api/presets', {
    name: '  Mi afinación  ',
    strings: [80, 110.004, 146.83, 196, 246.94, 329.63],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Mi afinación');
  assert.equal(created.body.strings[1], 110);
  const { id } = created.body;

  const updated = await call('PUT', `/api/presets/${id}`, { name: 'Renombrada', strings: [81, 110, 146.83, 196, 246.94, 329.63] });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.strings[0], 81);

  assert.equal((await call('PUT', '/api/active', { id })).status, 204);
  assert.equal((await call('GET', '/api/presets')).body.activeId, id);

  assert.equal((await call('DELETE', `/api/presets/${id}`)).status, 204);
  const after = (await call('GET', '/api/presets')).body;
  assert.ok(!after.presets.some((p) => p.id === id));
  assert.equal(after.activeId, 'standard', 'vuelve a la primera si se borra la activa');
});

test('rechaza datos inválidos', async () => {
  const badHz = await call('POST', '/api/presets', { name: 'X', strings: [10, 110, 146, 196, 246, 329] });
  assert.equal(badHz.status, 400);
  assert.match(badHz.body.error, /6ª cuerda/);
  assert.equal((await call('POST', '/api/presets', { name: '', strings: [82, 110, 146, 196, 246, 329] })).status, 400);
  assert.equal((await call('POST', '/api/presets', { name: 'X', strings: [82, 110] })).status, 400);
  assert.equal((await call('PUT', '/api/presets/no-existe', { name: 'X', strings: [82, 110, 146, 196, 246, 329] })).status, 404);
  assert.equal((await call('PUT', '/api/active', { id: 'no-existe' })).status, 404);
});

test('restaurar repone predefinidas editadas o borradas y conserva las personalizadas', async () => {
  await call('PUT', '/api/presets/standard', { name: 'Editada', strings: [80, 110, 146.83, 196, 246.94, 329.63] });
  await call('DELETE', '/api/presets/dadgad');
  const custom = (await call('POST', '/api/presets', { name: 'Custom', strings: [82, 110, 146, 196, 246, 329] })).body;

  const { body } = await call('POST', '/api/presets/restore-defaults');
  const standard = body.presets.find((p) => p.id === 'standard');
  assert.equal(standard.name, DEFAULT_PRESETS[0].name);
  assert.equal(standard.strings[0], 82.41);
  assert.ok(body.presets.some((p) => p.id === 'dadgad'));
  assert.equal(body.presets.at(-1).id, custom.id);
});

test('no permite eliminar la última afinación', async () => {
  const { presets } = (await call('GET', '/api/presets')).body;
  for (const p of presets.slice(1)) await call('DELETE', `/api/presets/${p.id}`);
  const last = await call('DELETE', `/api/presets/${presets[0].id}`);
  assert.equal(last.status, 409);
});

test('guarda y valida la sensibilidad del micrófono', async () => {
  assert.deepEqual((await call('GET', '/api/settings')).body, { sensitivityDb: -44.5 });
  const saved = await call('PUT', '/api/settings', { sensitivityDb: -38.27 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.sensitivityDb, -38.3);
  assert.equal((await call('PUT', '/api/settings', { sensitivityDb: -5 })).status, 400);
  assert.equal((await call('PUT', '/api/settings', { sensitivityDb: 'x' })).status, 400);
  assert.equal((await call('GET', '/api/settings')).body.sensitivityDb, -38.3);
});

test('los datos persisten al reabrir la base', () => {
  const custom = store.create({ name: 'Persistente', strings: [70, 100, 140, 190, 240, 320] });
  store.setActiveId(custom.id);
  const reopened = openDatabase(dbFile);
  assert.ok(reopened.list().some((p) => p.name === 'Persistente'));
  assert.equal(reopened.getActiveId(), custom.id);
  assert.equal(reopened.getSettings().sensitivityDb, -38.3);
  reopened.close();
});
