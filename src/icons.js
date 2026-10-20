// Íconos vectoriales (Lucide). Solo se importan los usados, para que Vite descarte el resto.

import {
  createElement,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Gauge,
  ListMusic,
  Lock,
  Metronome,
  Mic,
  Minus,
  Pencil,
  Play,
  Plus,
  Repeat,
  Settings,
  SlidersHorizontal,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide';

const ICONS = {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Gauge,
  ListMusic,
  Lock,
  Metronome,
  Mic,
  Minus,
  Pencil,
  Play,
  Plus,
  Repeat,
  Settings,
  SlidersHorizontal,
  Square,
  Trash2,
  TriangleAlert,
  X,
};

export function icon(name, className = '') {
  return createElement(ICONS[name], { class: `icon ${className}`.trim(), 'aria-hidden': 'true' });
}

/** Reemplaza cada `<span data-icon="Nombre">` dentro de `root` por su SVG, conservando sus clases. */
export function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => el.replaceWith(icon(el.dataset.icon, el.className)));
}
