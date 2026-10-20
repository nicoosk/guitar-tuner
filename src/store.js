// Persistencia de afinaciones y ajustes en el navegador (localStorage).
// Todo se guarda como un único documento JSON bajo STORAGE_KEY:
//   { presets: [{ id, name, isDefault, strings }], activeId, sensitivityDb, chime, view, tabs: [...], activeTabId }

import { DEFAULT_PRESETS, DEFAULT_SENSITIVITY_DB, validatePreset, validateSensitivity } from './presets-shared.js';
import { validateTab } from './tabs.js';

export const STORAGE_KEY = 'afinador:v1';
export const VIEWS = ['tuner', 'tabs'];

const defaultPresets = () => DEFAULT_PRESETS.map((p) => ({ ...p, isDefault: true, strings: [...p.strings] }));
const DEFAULTS_BY_ID = new Map(DEFAULT_PRESETS.map((p) => [p.id, p]));

// Nombres que tenían las predefinidas antes de ser de solo lectura (para migrar las que se editaron).
const LEGACY_DEFAULT_NAMES = new Set([
  'Estándar (E A D G B E)',
  'Drop D (D A D G B E)',
  'Medio tono abajo (Eb)',
  'Open G (D G D G B D)',
  'Open D (D A D F# A D)',
]);

const newId = () => globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Almacenamiento en memoria, para cuando localStorage no está disponible (p. ej. modo privado). */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

/**
 * Las predefinidas siempre están, con sus valores originales, y van primero. Una predefinida que
 * se editó cuando aún se podía pasa a ser personalizada (conserva sus valores) y queda activa si lo era.
 */
function mergeDefaults(stored, activeId) {
  const custom = [];
  let active = activeId;
  for (const p of stored) {
    const original = DEFAULTS_BY_ID.get(p.id);
    if (!original) {
      custom.push({ ...p, isDefault: false });
    } else if (p.strings.some((hz, i) => hz !== original.strings[i])) {
      const renamed = p.name === original.name || LEGACY_DEFAULT_NAMES.has(p.name);
      const migrated = { id: newId(), name: renamed ? `${original.name} (editada)` : p.name, isDefault: false, strings: p.strings };
      custom.push(migrated);
      if (active === p.id) active = migrated.id;
    }
  }
  return { presets: [...defaultPresets(), ...custom], activeId: active };
}

/** Descarta lo que no tenga la forma esperada; si no queda nada usable, vuelve a las predefinidas. */
function sanitize(raw) {
  const stored = Array.isArray(raw?.presets)
    ? raw.presets.flatMap((p) => {
        const { value } = validatePreset(p);
        return value && typeof p.id === 'string' ? [{ id: p.id, name: value.name, strings: value.strings }] : [];
      })
    : [];
  const tabs = Array.isArray(raw?.tabs)
    ? raw.tabs.flatMap((t) => {
        const { value } = validateTab(t);
        return value && typeof t.id === 'string' ? [{ id: t.id, ...value }] : [];
      })
    : [];
  const { presets, activeId } = mergeDefaults(stored, typeof raw?.activeId === 'string' ? raw.activeId : null);
  return {
    presets,
    activeId,
    sensitivityDb: validateSensitivity(raw?.sensitivityDb) ?? DEFAULT_SENSITIVITY_DB,
    chime: typeof raw?.chime === 'boolean' ? raw.chime : true,
    view: VIEWS.includes(raw?.view) ? raw.view : VIEWS[0],
    tabs,
    activeTabId: typeof raw?.activeTabId === 'string' ? raw.activeTabId : null,
  };
}

/** Abre el almacén sobre `storage` (interfaz getItem/setItem) y devuelve las operaciones. */
export function openStore(storage) {
  let data;
  try {
    data = sanitize(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    data = sanitize(null);
  }

  const save = () => storage.setItem(STORAGE_KEY, JSON.stringify(data));
  const find = (id) => data.presets.find((p) => p.id === id);
  const copy = (preset) => ({ ...preset, strings: [...preset.strings] });
  const findTab = (id) => data.tabs.find((t) => t.id === id);
  const copyTab = (tab) => ({ ...tab, notes: tab.notes.map((n) => [...n]) });

  const store = {
    list: () => data.presets.map(copy),

    /** Afinación activa; si la guardada ya no existe, la primera de la lista. */
    getActiveId: () => (data.activeId && find(data.activeId) ? data.activeId : data.presets[0]?.id ?? null),

    create({ name, strings }) {
      const preset = { id: newId(), name, isDefault: false, strings: [...strings] };
      data.presets.push(preset);
      save();
      return copy(preset);
    },

    /** Devuelve el preset actualizado, null si no existe o 'default' si es predefinido. */
    update(id, { name, strings }) {
      const preset = find(id);
      if (!preset) return null;
      if (preset.isDefault) return 'default';
      Object.assign(preset, { name, strings: [...strings] });
      save();
      return copy(preset);
    },

    /** 'deleted' | 'not-found' | 'default' (las predefinidas no se borran). */
    delete(id) {
      const preset = find(id);
      if (!preset) return 'not-found';
      if (preset.isDefault) return 'default';
      data.presets = data.presets.filter((p) => p.id !== id);
      save();
      return 'deleted';
    },

    setActiveId(id) {
      if (!find(id)) return false;
      data.activeId = id;
      save();
      return true;
    },

    getSettings: () => ({ sensitivityDb: data.sensitivityDb, chime: data.chime, view: data.view }),

    /** Actualiza solo los ajustes presentes en `settings` (ya validados). */
    updateSettings(settings) {
      if (settings.sensitivityDb !== undefined) data.sensitivityDb = settings.sensitivityDb;
      if (settings.chime !== undefined) data.chime = settings.chime;
      if (settings.view !== undefined) data.view = settings.view;
      save();
      return store.getSettings();
    },

    listTabs: () => data.tabs.map(copyTab),

    /** Tablatura activa; si la guardada ya no existe, la primera (o null si no hay ninguna). */
    getActiveTabId: () => (data.activeTabId && findTab(data.activeTabId) ? data.activeTabId : data.tabs[0]?.id ?? null),

    createTab(tab) {
      const created = { id: newId(), ...copyTab(tab) };
      data.tabs.push(created);
      data.activeTabId = created.id;
      save();
      return copyTab(created);
    },

    /** Devuelve la tablatura actualizada, o null si no existe. */
    updateTab(id, tab) {
      const existing = findTab(id);
      if (!existing) return null;
      Object.assign(existing, copyTab(tab), { id });
      save();
      return copyTab(existing);
    },

    deleteTab(id) {
      if (!findTab(id)) return false;
      data.tabs = data.tabs.filter((t) => t.id !== id);
      save();
      return true;
    },

    setActiveTabId(id) {
      if (!findTab(id)) return false;
      data.activeTabId = id;
      save();
      return true;
    },
  };

  return store;
}
