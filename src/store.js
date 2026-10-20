// Persistencia de afinaciones y ajustes en el navegador (localStorage).
// Todo se guarda como un único documento JSON bajo STORAGE_KEY:
//   { presets: [{ id, name, isDefault, strings }], activeId, sensitivityDb }

import { DEFAULT_PRESETS, DEFAULT_SENSITIVITY_DB, validatePreset, validateSensitivity } from './presets-shared.js';

export const STORAGE_KEY = 'afinador:v1';

const defaultPresets = () => DEFAULT_PRESETS.map((p) => ({ ...p, isDefault: true, strings: [...p.strings] }));

/** Almacenamiento en memoria, para cuando localStorage no está disponible (p. ej. modo privado). */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

/** Descarta lo que no tenga la forma esperada; si no queda nada usable, vuelve a las predefinidas. */
function sanitize(raw) {
  const presets = Array.isArray(raw?.presets)
    ? raw.presets.flatMap((p) => {
        const { value } = validatePreset(p);
        return value && typeof p.id === 'string' ? [{ id: p.id, name: value.name, isDefault: p.isDefault === true, strings: value.strings }] : [];
      })
    : [];
  return {
    presets: presets.length ? presets : defaultPresets(),
    activeId: typeof raw?.activeId === 'string' ? raw.activeId : null,
    sensitivityDb: validateSensitivity(raw?.sensitivityDb) ?? DEFAULT_SENSITIVITY_DB,
  };
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

    /** Devuelve el preset actualizado, o null si no existe. */
    update(id, { name, strings }) {
      const preset = find(id);
      if (!preset) return null;
      Object.assign(preset, { name, strings: [...strings] });
      save();
      return copy(preset);
    },

    /** 'deleted' | 'not-found' | 'last' (no se permite quedar sin afinaciones). */
    delete(id) {
      if (!find(id)) return 'not-found';
      if (data.presets.length <= 1) return 'last';
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

    getSettings: () => ({ sensitivityDb: data.sensitivityDb }),

    updateSettings({ sensitivityDb }) {
      data.sensitivityDb = sensitivityDb;
      save();
      return store.getSettings();
    },

    /** Repone las predefinidas con sus valores originales; las personalizadas quedan después. */
    restoreDefaults() {
      const defaultIds = new Set(DEFAULT_PRESETS.map((p) => p.id));
      data.presets = [...defaultPresets(), ...data.presets.filter((p) => !defaultIds.has(p.id))];
      save();
    },
  };

  return store;
}
