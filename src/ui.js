// Piezas de interfaz compartidas: hojas (dialog) y avisos breves con acción opcional (p. ej. Deshacer).

import { noteFromFrequency } from './tuning.js';

/** En pantallas táctiles no se enfoca un campo de texto al abrir: el teclado taparía la hoja. */
export const canAutofocus = () => window.matchMedia('(pointer: fine)').matches;

/** Notas de las cuerdas de 6ª a 1ª, p. ej. "E A D G B E". */
export const tuningNotes = (strings) => strings.map((hz) => noteFromFrequency(hz).name).join(' ');

/**
 * Prepara un <dialog> como hoja: se cierra con Esc (nativo), con los botones [data-close]
 * y al tocar fuera de él.
 */
export function setupSheet(dialog) {
  dialog.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const outside = event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    if (outside) dialog.close();
  });
  return dialog;
}

/** Aviso inferior. `show(mensaje, { error, actionLabel, onAction })`. */
export function createToast() {
  const el = document.getElementById('toast');
  const text = document.getElementById('toast-text');
  const action = document.getElementById('toast-action');
  const close = document.getElementById('toast-close');
  let timer = null;
  let onAction = null;

  const hide = () => {
    el.hidden = true;
    onAction = null;
    clearTimeout(timer);
  };

  action.addEventListener('click', () => {
    const fn = onAction;
    hide();
    fn?.();
  });
  close.addEventListener('click', hide);

  return {
    show(message, { error = false, actionLabel = 'Deshacer', onAction: handler = null } = {}) {
      text.textContent = message;
      el.classList.toggle('error', error);
      action.textContent = actionLabel;
      action.hidden = !handler;
      onAction = handler;
      el.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(hide, error ? 10000 : 6000);
    },
    hide,
  };
}
