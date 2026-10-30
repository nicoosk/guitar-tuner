export const MUSIC_KINDS = ['improvisation', 'song'];

export function validateMusic(input) {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  if (!title) return { error: 'Ponle un nombre.' };
  if (title.length > 80) return { error: 'El nombre admite hasta 80 caracteres.' };
  if (!MUSIC_KINDS.includes(input?.kind)) return { error: 'Tipo de entrada no válido.' };
  if (typeof input?.tuningId !== 'string' || !input.tuningId) return { error: 'Elige una afinación.' };
  return { value: { title, kind: input.kind, tuningId: input.tuningId, audioId: typeof input.audioId === 'string' ? input.audioId : null, duration: Number.isFinite(input.duration) && input.duration >= 0 ? input.duration : null, createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now() } };
}
