// API REST de afinaciones, como middleware compatible con Vite/Connect y node:http.
//
//   GET    /api/presets                  → { presets, activeId }
//   POST   /api/presets                  → crea { name, strings }
//   PUT    /api/presets/:id              → actualiza { name, strings }
//   DELETE /api/presets/:id              → elimina (no permite borrar la última)
//   POST   /api/presets/restore-defaults → repone predefinidas → { presets, activeId }
//   PUT    /api/active                   → { id } marca la afinación activa
//   GET    /api/settings                 → { sensitivityDb }
//   PUT    /api/settings                 → actualiza { sensitivityDb }

import { validatePreset, validateSensitivity } from '../src/presets-shared.js';

const MAX_BODY_BYTES = 16 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  res.statusCode = status;
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Solicitud demasiado grande.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

async function readPreset(req) {
  const { value, error } = validatePreset(await readJson(req));
  if (error) throw new HttpError(400, error);
  return value;
}

const snapshot = (store) => ({ presets: store.list(), activeId: store.getActiveId() });

async function route(store, req, res, path) {
  const { method } = req;

  if (path === '/api/presets') {
    if (method === 'GET') return send(res, 200, snapshot(store));
    if (method === 'POST') return send(res, 201, store.create(await readPreset(req)));
    throw new HttpError(405, 'Método no permitido.');
  }

  if (path === '/api/presets/restore-defaults' && method === 'POST') {
    store.restoreDefaults();
    return send(res, 200, snapshot(store));
  }

  const match = path.match(/^\/api\/presets\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (method === 'PUT') {
      const updated = store.update(id, await readPreset(req));
      if (!updated) throw new HttpError(404, 'Afinación no encontrada.');
      return send(res, 200, updated);
    }
    if (method === 'DELETE') {
      const result = store.delete(id);
      if (result === 'not-found') throw new HttpError(404, 'Afinación no encontrada.');
      if (result === 'last') throw new HttpError(409, 'Debe quedar al menos una afinación.');
      return send(res, 204);
    }
    throw new HttpError(405, 'Método no permitido.');
  }

  if (path === '/api/active' && method === 'PUT') {
    const { id } = await readJson(req);
    if (typeof id !== 'string' || !store.setActiveId(id)) throw new HttpError(404, 'Afinación no encontrada.');
    return send(res, 204);
  }

  if (path === '/api/settings') {
    if (method === 'GET') return send(res, 200, store.getSettings());
    if (method === 'PUT') {
      const sensitivityDb = validateSensitivity((await readJson(req)).sensitivityDb);
      if (sensitivityDb === null) throw new HttpError(400, 'Sensibilidad fuera de rango.');
      return send(res, 200, store.updateSettings({ sensitivityDb }));
    }
    throw new HttpError(405, 'Método no permitido.');
  }

  throw new HttpError(404, 'Ruta no encontrada.');
}

export function createApiMiddleware(store) {
  return async (req, res, next) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (!pathname.startsWith('/api/')) return next?.();
    try {
      await route(store, req, res, pathname);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error('[api]', err);
      send(res, 500, { error: 'Error interno del servidor.' });
    }
  };
}
