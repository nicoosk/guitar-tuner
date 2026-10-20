// Definiciones de afinaciones predefinidas y validación de datos del usuario.
// Cada preset: { id, name, isDefault, strings: [hz 6ª, 5ª, 4ª, 3ª, 2ª, 1ª] }
// Las predefinidas son de solo lectura: para cambiarlas se crea una nueva a partir de ellas.

import { STRING_COUNT } from './tuning.js';

export const MIN_HZ = 20;
export const MAX_HZ = 1500;
export const MAX_NAME_LENGTH = 40;

export const DEFAULT_PRESETS = [
  { id: 'standard', name: 'Estándar', strings: [82.41, 110.0, 146.83, 196.0, 246.94, 329.63] },
  { id: 'drop-d', name: 'Drop D', strings: [73.42, 110.0, 146.83, 196.0, 246.94, 329.63] },
  { id: 'half-down', name: 'Medio tono abajo', strings: [77.78, 103.83, 138.59, 185.0, 233.08, 311.13] },
  { id: 'dadgad', name: 'DADGAD', strings: [73.42, 110.0, 146.83, 196.0, 220.0, 293.66] },
  { id: 'open-g', name: 'Open G', strings: [73.42, 98.0, 146.83, 196.0, 246.94, 293.66] },
  { id: 'open-d', name: 'Open D', strings: [73.42, 110.0, 146.83, 185.0, 220.0, 293.66] },
];

// Sensibilidad del micrófono: umbral de volumen en dBFS bajo el cual se ignora el sonido.
export const SENSITIVITY_MIN_DB = -60;
export const SENSITIVITY_MAX_DB = -20;
export const DEFAULT_SENSITIVITY_DB = -44.5; // ≈ 0.006 RMS

/** Devuelve el umbral normalizado (1 decimal) o null si es inválido. */
export function validateSensitivity(value) {
  const db = Number(value);
  if (!Number.isFinite(db) || db < SENSITIVITY_MIN_DB || db > SENSITIVITY_MAX_DB) return null;
  return Math.round(db * 10) / 10;
}

/**
 * Valida y normaliza { name, strings } recibido del usuario.
 * Devuelve { value } si es válido o { error } con un mensaje legible.
 */
export function validatePreset(input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name) return { error: 'La afinación necesita un nombre.' };
  if (name.length > MAX_NAME_LENGTH) return { error: `El nombre admite hasta ${MAX_NAME_LENGTH} caracteres.` };

  if (!Array.isArray(input.strings) || input.strings.length !== STRING_COUNT) {
    return { error: `Se requieren las ${STRING_COUNT} cuerdas.` };
  }
  const strings = [];
  for (let i = 0; i < STRING_COUNT; i++) {
    const hz = Number(input.strings[i]);
    if (!Number.isFinite(hz) || hz < MIN_HZ || hz > MAX_HZ) {
      return { error: `La ${STRING_COUNT - i}ª cuerda debe estar entre ${MIN_HZ} y ${MAX_HZ} Hz.` };
    }
    strings.push(Math.round(hz * 100) / 100);
  }
  return { value: { name, strings } };
}
