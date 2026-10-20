// Acceso a afinaciones, tablaturas y ajustes, guardados en el propio navegador (sin servidor).
// Mantiene una interfaz asíncrona y lanza Error con mensajes legibles, como antes la API REST.

import { validatePreset, validateSensitivity } from './presets-shared.js';
import { openStore, memoryStorage, VIEWS } from './store.js';
import { validateTab } from './tabs.js';

function browserStorage() {
  try {
    const probe = '__afinador_probe__';
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    console.warn('[afinador] localStorage no disponible; los cambios no se guardarán al cerrar.');
    return memoryStorage();
  }
}

let store;
const getStore = () => (store ??= openStore(browserStorage()));

// Ejecuta `fn` sobre el almacén; un fallo al escribir (p. ej. sin espacio) llega como Error legible.
async function run(fn) {
  try {
    return fn(getStore());
  } catch (err) {
    if (err?.name === 'QuotaExceededError') throw new Error('No hay espacio para guardar en este navegador.');
    throw err;
  }
}

function readPreset(input) {
  const { value, error } = validatePreset(input);
  if (error) throw new Error(error);
  return value;
}

const snapshot = (s) => ({ presets: s.list(), activeId: s.getActiveId() });

export const fetchPresets = () => run(snapshot);

export const createPreset = (preset) => run((s) => s.create(readPreset(preset)));

const READ_ONLY = 'Las afinaciones predefinidas no se pueden cambiar; crea una nueva a partir de ella.';

export const updatePreset = (id, preset) =>
  run((s) => {
    const updated = s.update(id, readPreset(preset));
    if (updated === 'default') throw new Error(READ_ONLY);
    if (!updated) throw new Error('Afinación no encontrada.');
    return updated;
  });

export const deletePreset = (id) =>
  run((s) => {
    const result = s.delete(id);
    if (result === 'not-found') throw new Error('Afinación no encontrada.');
    if (result === 'default') throw new Error(READ_ONLY);
    return null;
  });

export const setActivePreset = (id) =>
  run((s) => {
    if (!s.setActiveId(id)) throw new Error('Afinación no encontrada.');
    return null;
  });

export const fetchSettings = () => run((s) => s.getSettings());

/** Actualiza solo los ajustes indicados: { sensitivityDb?, chime?, view? }. */
export const updateSettings = (settings) =>
  run((s) => {
    const changes = {};
    if ('sensitivityDb' in settings) {
      changes.sensitivityDb = validateSensitivity(settings.sensitivityDb);
      if (changes.sensitivityDb === null) throw new Error('Sensibilidad fuera de rango.');
    }
    if ('chime' in settings) {
      if (typeof settings.chime !== 'boolean') throw new Error('Ajuste de sonido no válido.');
      changes.chime = settings.chime;
    }
    if ('view' in settings) {
      if (!VIEWS.includes(settings.view)) throw new Error('Vista no válida.');
      changes.view = settings.view;
    }
    return s.updateSettings(changes);
  });

// ---------- Tablaturas ----------

function readTab(input) {
  const { value, error } = validateTab(input);
  if (error) throw new Error(error);
  return value;
}

const tabsSnapshot = (s) => ({ tabs: s.listTabs(), activeTabId: s.getActiveTabId() });

export const fetchTabs = () => run(tabsSnapshot);

export const createTab = (tab) => run((s) => s.createTab(readTab(tab)));

export const updateTab = (id, tab) =>
  run((s) => {
    const updated = s.updateTab(id, readTab(tab));
    if (!updated) throw new Error('Tablatura no encontrada.');
    return updated;
  });

export const deleteTab = (id) =>
  run((s) => {
    if (!s.deleteTab(id)) throw new Error('Tablatura no encontrada.');
    return tabsSnapshot(s);
  });

export const setActiveTab = (id) =>
  run((s) => {
    if (!s.setActiveTabId(id)) throw new Error('Tablatura no encontrada.');
    return null;
  });
