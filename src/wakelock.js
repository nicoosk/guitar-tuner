// Mantiene la pantalla encendida mientras se afina (Screen Wake Lock API).
// El navegador libera el bloqueo al cambiar de pestaña, así que se vuelve a pedir al regresar.

let sentinel = null;

async function request() {
  try {
    sentinel = await navigator.wakeLock.request('screen');
  } catch {
    // Denegado (batería baja, política del navegador): la app sigue funcionando igual.
  }
}

export function keepScreenAwake() {
  if (!('wakeLock' in navigator)) return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) request();
  });
  request();
}
