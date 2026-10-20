# Afinador de guitarra

Afinador en el navegador para guitarra acústica: detecta automáticamente qué cuerda estás tocando, permite fijar una cuerda (1ª a 6ª) y guarda afinaciones personalizadas (nombre + Hz por cuerda) en el propio navegador.

Además tiene un modo **Tablaturas** para escribir tus propias tablaturas y reproducirlas con la afinación seleccionada.

Es una app 100 % estática e instalable (PWA): no necesita servidor y funciona sin conexión.

**App publicada:** https://nicoosk.github.io/guitar-tuner/

## Instalar en iPhone

1. Abrir la URL en **Safari**.
2. *Compartir* → **Agregar a pantalla de inicio**.
3. Abrirla siempre desde ese ícono (a pantalla completa, offline y sin que iOS borre las afinaciones guardadas).

## Tablaturas

- Cada tablatura tiene nombre, tempo (BPM), largo en compases, tiempos por compás y notas por tiempo (negras, corcheas, tresillos o semicorcheas).
- La grilla muestra las 6 cuerdas (1ª arriba, como en una tablatura impresa). Toca una celda y elige el traste (0–24) en el teclado inferior; suena la nota al escribirla.
- Con teclado físico: dígitos para el traste (dos seguidos = 10–24), flechas para moverse, Borrar para quitar la nota y espacio para reproducir.
- Al reproducir, cada traste se convierte en frecuencia según la **afinación activa** (cambiarla actualiza nombres de cuerdas y sonido). Cada nota suena hasta la siguiente en su misma cuerda.
- Opciones de repetir (loop) y metrónomo; el BPM se puede ajustar mientras suena.
- Al cambiar largo o subdivisión las notas conservan su posición en el tiempo; si alguna queda fuera o entre pasos, se avisa antes de guardar.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
```

Otros comandos:

- `npm start` — build de producción y vista previa (`vite preview`, puerto 4173)
- `npm test` — pruebas de detección, tablaturas y almacenamiento

## Deploy

Cada push a `main` ejecuta `.github/workflows/deploy.yml`: corre los tests, compila con `BASE_PATH=/guitar-tuner/` y publica `dist/` en GitHub Pages. Requiere, una sola vez, *Settings → Pages → Source: GitHub Actions* en el repositorio.

## Estructura

| Ruta | Contenido |
|---|---|
| `src/main.js` | Interfaz: medidor, cuerdas, editor de afinaciones |
| `src/icons.js` | Íconos vectoriales (`lucide`); solo se importan los usados |
| `src/reference.js` | Síntesis de cuerda pulsada: tono de referencia, notas de tablatura y metrónomo |
| `src/tabs.js` | Modelo de tablaturas: validación, traste → frecuencia, línea de tiempo |
| `src/tab-player.js` | Reproductor de tablaturas sincronizado con el reloj de audio |
| `src/tab-view.js` | Vista de tablaturas: grilla, teclado de trastes, ajustes y reproducción |
| `src/wakelock.js` | Mantiene la pantalla encendida mientras el micrófono está activo |
| `src/pitch.js` | Micrófono (Web Audio) + detección de frecuencia (`pitchy`, algoritmo McLeod) |
| `src/tuning.js` | Cálculos musicales: cents, nota más cercana, cuerda más cercana |
| `src/presets-shared.js` | Afinaciones predefinidas y validación |
| `src/store.js` | Persistencia en `localStorage` (afinaciones, tablaturas, modo y sensibilidad) |
| `src/api.js` | Interfaz asíncrona sobre `store.js` usada por la UI |
| `public/` | Íconos de la app (manifest y `apple-touch-icon`) |
| `vite.config.js` | Build y PWA (`vite-plugin-pwa`: manifest + service worker offline) |

## Notas

- El micrófono solo funciona en `localhost` o con HTTPS (GitHub Pages ya sirve HTTPS).
- Las afinaciones quedan guardadas por dispositivo y navegador; no se sincronizan entre equipos.
- Se considera afinada una cuerda dentro de ±3 cents; tras 0,6 s afinada queda marcada con ✓.
- La barra bajo el medidor muestra el nivel del micrófono en vivo; su marcador es el umbral de sensibilidad (se guarda junto a las afinaciones). Señal bajo el umbral = se ignora.
- Mientras suena el tono de referencia el micrófono no se evalúa, para no "afinar" con el propio parlante.
- Requiere Node 18+ (probado con Node 20).
