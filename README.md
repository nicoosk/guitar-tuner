# Afinador de guitarra

Afinador en el navegador para guitarra acústica: detecta automáticamente qué cuerda estás tocando, permite fijar una cuerda (1ª a 6ª) y guarda afinaciones personalizadas (nombre + Hz por cuerda) en SQLite.

## Uso

```bash
npm install
npm run dev        # http://localhost:5173
```

Otros comandos:

- `npm start` — build de producción y servidor (`vite preview`, puerto 4173)
- `npm test` — pruebas de detección y de la API/SQLite

## Estructura

| Ruta | Contenido |
|---|---|
| `src/main.js` | Interfaz: medidor, cuerdas, editor de afinaciones |
| `src/icons.js` | Íconos vectoriales (`lucide`); solo se importan los usados |
| `src/reference.js` | Tono de referencia sintetizado (cuerda pulsada, afinación exacta) |
| `src/wakelock.js` | Mantiene la pantalla encendida mientras el micrófono está activo |
| `src/pitch.js` | Micrófono (Web Audio) + detección de frecuencia (`pitchy`, algoritmo McLeod) |
| `src/tuning.js` | Cálculos musicales: cents, nota más cercana, cuerda más cercana |
| `src/presets-shared.js` | Afinaciones predefinidas y validación (compartido cliente/servidor) |
| `server/db.js` | Persistencia SQLite (`better-sqlite3`) |
| `server/api.js` | API REST `/api/*`, montada dentro del servidor de Vite (`vite.config.js`) |
| `data/afinador.db` | Base de datos (se crea sola; ruta configurable con `AFINADOR_DB`) |

## Notas

- El micrófono solo funciona en `localhost` o con HTTPS. Para usarlo desde el celular en la red local se necesita HTTPS.
- Se considera afinada una cuerda dentro de ±3 cents; tras 0,6 s afinada queda marcada con ✓.
- La barra bajo el medidor muestra el nivel del micrófono en vivo; su marcador es el umbral de sensibilidad (se guarda en SQLite). Señal bajo el umbral = se ignora.
- Mientras suena el tono de referencia el micrófono no se evalúa, para no "afinar" con el propio parlante.
- Requiere Node 18+ (probado con Node 20).
