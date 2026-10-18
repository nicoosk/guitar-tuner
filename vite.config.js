import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { openDatabase } from './server/db.js';
import { createApiMiddleware } from './server/api.js';

// Monta la API de afinaciones (SQLite) dentro del servidor de Vite, tanto en
// `npm run dev` como en `npm run preview`. La base se abre solo al levantar el servidor.
function presetsApi() {
  let middleware;
  const getMiddleware = () => {
    middleware ??= createApiMiddleware(openDatabase(process.env.AFINADOR_DB ?? resolve('data/afinador.db')));
    return middleware;
  };
  return {
    name: 'presets-api',
    configureServer: (server) => void server.middlewares.use(getMiddleware()),
    configurePreviewServer: (server) => void server.middlewares.use(getMiddleware()),
  };
}

export default defineConfig({
  plugins: [presetsApi()],
  server: { watch: { ignored: ['**/data/**'] } },
});
