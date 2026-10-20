// Íconos vectoriales (Lucide). Solo se importan los usados, para que Vite descarte el resto.

import {
  createElement,
  ArrowDown,
  ArrowUp,
  AudioWaveform,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Eraser,
  Gauge,
  Guitar,
  ListMusic,
  Lock,
  Metronome,
  Mic,
  Minus,
  Pencil,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Tag,
  Target,
  Trash2,
  TriangleAlert,
  Volume2,
  X,
} from 'lucide';

const ICONS = {
  ArrowDown,
  ArrowUp,
  AudioWaveform,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Eraser,
  Gauge,
  Guitar,
  ListMusic,
  Lock,
  Metronome,
  Mic,
  Minus,
  Pencil,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Tag,
  Target,
  Trash2,
  TriangleAlert,
  Volume2,
  X,
};

export function icon(name, className = '') {
  return createElement(ICONS[name], { class: `icon ${className}`.trim(), 'aria-hidden': 'true' });
}

/** Reemplaza cada `<span data-icon="Nombre">` dentro de `root` por su SVG, conservando sus clases. */
export function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => el.replaceWith(icon(el.dataset.icon, el.className)));
}
