// Mantiene la pantalla encendida mientras se afina (Screen Wake Lock API).
// El navegador libera el bloqueo al cambiar de pestaña, así que se vuelve a pedir al regresar.

let sentinel = null;
let started = false;

async function request() {
  try {
    sentinel = await navigator.wakeLock.request('screen');
  } catch {
    // Denegado (batería baja, política del navegador): la app sigue funcionando igual.
  }
}

/** Pide mantener la pantalla encendida; se puede llamar varias veces (solo se activa una). */
export function keepScreenAwake() {
  if (!('wakeLock' in navigator) || started) return;
  started = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) request();
  });
  request();
}
