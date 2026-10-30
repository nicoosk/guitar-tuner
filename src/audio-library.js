const DB = 'afinador-audio-v1';
const STORE = 'recordings';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction(mode, fn) {
  if (!('indexedDB' in window)) throw new Error('Este navegador no permite guardar grabaciones.');
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = fn(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}
export const saveRecording = (id, blob) => transaction('readwrite', (store) => store.put(blob, id));
export const getRecording = (id) => transaction('readonly', (store) => store.get(id));
export const deleteRecording = (id) => transaction('readwrite', (store) => store.delete(id));

/** Resume la amplitud real del archivo; las barras bajas corresponden a silencios. */
export async function waveformFor(blob, count = 40) {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw new Error('No se puede leer la forma de onda.');
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = buffer.getChannelData(0);
    const block = Math.ceil(samples.length / count);
    const peaks = Array.from({ length: count }, (_, index) => {
      let peak = 0;
      for (let i = index * block; i < Math.min(samples.length, (index + 1) * block); i++) peak = Math.max(peak, Math.abs(samples[i]));
      return peak;
    });
    const max = Math.max(...peaks, 0.001);
    return peaks.map((peak) => Math.sqrt(peak / max));
  } finally { context.close(); }
}

export async function recordAudio() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Tu navegador no puede grabar audio.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  const stopped = new Promise((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    };
  });
  recorder.start();
  return { stop: async () => { recorder.stop(); return stopped; } };
}
