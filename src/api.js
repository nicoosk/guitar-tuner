// Cliente de la API de afinaciones.

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

export const fetchPresets = () => request('GET', '/api/presets');
export const createPreset = (preset) => request('POST', '/api/presets', preset);
export const updatePreset = (id, preset) => request('PUT', `/api/presets/${encodeURIComponent(id)}`, preset);
export const deletePreset = (id) => request('DELETE', `/api/presets/${encodeURIComponent(id)}`);
export const restoreDefaults = () => request('POST', '/api/presets/restore-defaults');
export const setActivePreset = (id) => request('PUT', '/api/active', { id });
export const fetchSettings = () => request('GET', '/api/settings');
export const updateSettings = (settings) => request('PUT', '/api/settings', settings);
