# Afinador de guitarra

Afinador en el navegador para guitarra acústica: detecta automáticamente qué cuerda estás tocando, deja tocar una cuerda en pantalla para escucharla (y fijarla como objetivo) y guarda afinaciones personalizadas (nombre + Hz por cuerda) en el propio navegador.

Además tiene un modo **Tablaturas** para escribir tus propias tablaturas y reproducirlas con la afinación seleccionada.

Es una app 100 % estática e instalable (PWA): no necesita servidor y funciona sin conexión.

**App publicada:** https://nicoosk.github.io/guitar-tuner/

## Instalar en iPhone

1. Abrir la URL en **Safari**.
2. *Compartir* → **Agregar a pantalla de inicio**.
3. Abrirla siempre desde ese ícono (a pantalla completa, offline y sin que iOS borre las afinaciones guardadas).

## Tablaturas

- Cada tablatura tiene nombre, tempo (BPM), largo en compases, tiempos por compás y notas por tiempo (negras, corcheas, tresillos o semicorcheas).
- *Nueva tablatura* abre directo una grilla de 4 compases en 4/4; el botón **+** al final de la grilla agrega compases.
- La grilla muestra las 6 cuerdas (1ª arriba, como en una tablatura impresa). Toca una celda y elige el traste (0–24) en el teclado inferior; suena la nota al escribirla y la selección avanza al paso siguiente.
- Con teclado físico: dígitos para el traste (dos seguidos = 10–24), flechas para moverse, Borrar para quitar la nota y espacio para reproducir.
- Al reproducir, cada traste se convierte en frecuencia según la **afinación activa** (cambiarla actualiza nombres de cuerdas y sonido). Cada nota suena hasta la siguiente en su misma cuerda.
- Opciones de repetir (loop) y metrónomo; el BPM se puede ajustar mientras suena.
- Al cambiar largo o subdivisión las notas conservan su posición en el tiempo; si alguna queda fuera o entre pasos, el propio formulario lo avisa antes de guardar.
- Eliminar una tablatura o una afinación se puede deshacer desde el aviso que aparece abajo.

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
| `src/main.js` | Interfaz: medidor, cuerdas, micrófono, lista y editor de afinaciones, ajustes |
| `src/ui.js` | Hojas (`dialog`) y avisos con *Deshacer* compartidos |
| `src/icons.js` | Íconos vectoriales (`lucide`); solo se importan los usados |
| `src/reference.js` | Síntesis de cuerda pulsada: tono de referencia, notas de tablatura, metrónomo y aviso de cuerda afinada |
| `src/tabs.js` | Modelo de tablaturas: validación, traste → frecuencia, línea de tiempo |
| `src/tab-player.js` | Reproductor de tablaturas sincronizado con el reloj de audio |
| `src/tab-view.js` | Vista de tablaturas: grilla, teclado de trastes, ajustes y reproducción |
| `src/wakelock.js` | Mantiene la pantalla encendida mientras el micrófono está activo |
| `src/pitch.js` | Micrófono (Web Audio) + detección de frecuencia (`pitchy`, algoritmo McLeod) |
| `src/tuning.js` | Cálculos musicales: cents, nota más cercana, cuerda más cercana |
| `src/presets-shared.js` | Afinaciones predefinidas (de solo lectura) y validación |
| `src/store.js` | Persistencia en `localStorage` (afinaciones, tablaturas, modo, sensibilidad y sonido) |
| `src/api.js` | Interfaz asíncrona sobre `store.js` usada por la UI |
| `public/` | Íconos de la app (manifest y `apple-touch-icon`) |
| `vite.config.js` | Build y PWA (`vite-plugin-pwa`: manifest + service worker offline) |

## Notas

- El micrófono solo funciona en `localhost` o con HTTPS (GitHub Pages ya sirve HTTPS).
- Las afinaciones quedan guardadas por dispositivo y navegador; no se sincronizan entre equipos.
- Se considera afinada una cuerda dentro de ±3 cents; tras 0,6 s afinada queda marcada con ✓ (con un aviso sonoro corto, desactivable en *Ajustes*). Con las 6 afinadas aparece *Guitarra afinada*.
- Las afinaciones predefinidas no se editan: *Nueva a partir de…* crea una copia editable. Si una predefinida se había editado en una versión anterior, se conserva como afinación propia.
- La sensibilidad del micrófono está en *Ajustes*: la barra muestra el nivel en vivo y la marca es el umbral (señal bajo el umbral = se ignora).
- Sin permiso de micrófono la app sigue funcionando: se puede afinar de oído tocando las cuerdas en pantalla, y Tablaturas no lo necesita.
- Respeta el tema claro u oscuro del sistema.
- Mientras suena el tono de referencia el micrófono no se evalúa, para no "afinar" con el propio parlante.
- Requiere Node 18+ (probado con Node 20).
