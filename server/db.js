// Persistencia de afinaciones en SQLite (better-sqlite3).

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PRESETS, DEFAULT_SENSITIVITY_DB } from '../src/presets-shared.js';

const STRING_COLUMNS = ['string_6', 'string_5', 'string_4', 'string_3', 'string_2', 'string_1'];
const COLUMN_LIST = STRING_COLUMNS.join(', ');
const PARAM_LIST = STRING_COLUMNS.map((c) => `@${c}`).join(', ');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS presets (
    id         TEXT PRIMARY KEY,
    name       TEXT    NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL,
    ${STRING_COLUMNS.map((c) => `${c} REAL NOT NULL`).join(',\n    ')},
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

const stringParams = (strings) => Object.fromEntries(STRING_COLUMNS.map((c, i) => [c, strings[i]]));

const rowToPreset = (row) => ({
  id: row.id,
  name: row.name,
  isDefault: row.is_default === 1,
  strings: STRING_COLUMNS.map((c) => row[c]),
});

/** Abre (o crea) la base en `file` y devuelve las operaciones sobre afinaciones. */
export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const stmt = {
    list: db.prepare('SELECT * FROM presets ORDER BY position, created_at'),
    get: db.prepare('SELECT * FROM presets WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM presets'),
    nextPosition: db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM presets'),
    insert: db.prepare(
      `INSERT INTO presets (id, name, is_default, position, ${COLUMN_LIST})
       VALUES (@id, @name, 0, @position, ${PARAM_LIST})`,
    ),
    upsertDefault: db.prepare(
      `INSERT INTO presets (id, name, is_default, position, ${COLUMN_LIST})
       VALUES (@id, @name, 1, @position, ${PARAM_LIST})
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, is_default = 1, position = excluded.position,
         ${STRING_COLUMNS.map((c) => `${c} = excluded.${c}`).join(', ')},
         updated_at = datetime('now')`,
    ),
    update: db.prepare(
      `UPDATE presets SET name = @name, ${STRING_COLUMNS.map((c) => `${c} = @${c}`).join(', ')},
         updated_at = datetime('now')
       WHERE id = @id`,
    ),
    setPosition: db.prepare('UPDATE presets SET position = ? WHERE id = ?'),
    delete: db.prepare('DELETE FROM presets WHERE id = ?'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ),
  };

  const store = {
    list: () => stmt.list.all().map(rowToPreset),

    get(id) {
      const row = stmt.get.get(id);
      return row ? rowToPreset(row) : null;
    },

    create({ name, strings }) {
      const id = randomUUID();
      stmt.insert.run({ id, name, position: stmt.nextPosition.get().pos, ...stringParams(strings) });
      return store.get(id);
    },

    /** Devuelve el preset actualizado, o null si no existe. */
    update(id, { name, strings }) {
      const { changes } = stmt.update.run({ id, name, ...stringParams(strings) });
      return changes ? store.get(id) : null;
    },

    /** 'deleted' | 'not-found' | 'last' (no se permite quedar sin afinaciones). */
    delete: db.transaction((id) => {
      if (!stmt.get.get(id)) return 'not-found';
      if (stmt.count.get().n <= 1) return 'last';
      stmt.delete.run(id);
      return 'deleted';
    }),

    /** Afinación activa; si la guardada ya no existe, la primera de la lista. */
    getActiveId() {
      const saved = stmt.getSetting.get('active_preset')?.value;
      if (saved && stmt.get.get(saved)) return saved;
      return stmt.list.get()?.id ?? null;
    },

    setActiveId(id) {
      if (!stmt.get.get(id)) return false;
      stmt.setSetting.run('active_preset', id);
      return true;
    },

    getSettings() {
      const saved = stmt.getSetting.get('sensitivity_db')?.value;
      return { sensitivityDb: saved == null ? DEFAULT_SENSITIVITY_DB : Number(saved) };
    },

    updateSettings({ sensitivityDb }) {
      stmt.setSetting.run('sensitivity_db', String(sensitivityDb));
      return store.getSettings();
    },

    /** Repone las predefinidas con sus valores originales; las personalizadas quedan después. */
    restoreDefaults: db.transaction(() => {
      const defaultIds = new Set(DEFAULT_PRESETS.map((p) => p.id));
      const custom = stmt.list.all().filter((row) => !defaultIds.has(row.id));
      DEFAULT_PRESETS.forEach((p, position) => {
        stmt.upsertDefault.run({ id: p.id, name: p.name, position, ...stringParams(p.strings) });
      });
      custom.forEach((row, i) => stmt.setPosition.run(DEFAULT_PRESETS.length + i, row.id));
    }),

    close: () => db.close(),
  };

  if (stmt.count.get().n === 0) store.restoreDefaults();
  return store;
}
