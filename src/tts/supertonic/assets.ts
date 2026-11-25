// File del modello Supertonic 3, scaricati una volta da Hugging Face e salvati nella Cache del browser.

export const REPO_BASE =
  'https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46/';
export const CACHE_NAME = 'supertonic-3';

export const VOICE_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

/** Percorso → dimensione in byte (serve per la barra di avanzamento). */
export const FILES: Record<string, number> = {
  'onnx/tts.json': 8253,
  'onnx/unicode_indexer.json': 277676,
  'onnx/duration_predictor.onnx': 3700147,
  'onnx/text_encoder.onnx': 36416150,
  'onnx/vector_estimator.onnx': 256534781,
  'onnx/vocoder.onnx': 101424195,
  ...Object.fromEntries(VOICE_IDS.map((v) => [`voice_styles/${v}.json`, 292000])),
};

export const TOTAL_MB = Math.round(Object.values(FILES).reduce((a, b) => a + b, 0) / 1e6);

export const fileUrl = (path: string) => REPO_BASE + path;
/** Segnalino salvato solo quando un file è stato scaricato per intero (contiene i byte ricevuti). */
const okUrl = (path: string) => `${fileUrl(path)}?scaricato=ok`;
/** File di cui conosciamo la dimensione esatta (le voci variano di poco). */
const exactSize = (path: string) => !path.startsWith('voice_styles/');

/** Il file è in cache e completo? */
async function isComplete(cache: Cache, path: string): Promise<boolean> {
  const [file, ok] = await Promise.all([cache.match(fileUrl(path)), cache.match(okUrl(path))]);
  if (!file || !ok) return false;
  const bytes = Number(await ok.text());
  return exactSize(path) ? bytes === FILES[path] : bytes > 1000;
}

export async function isDownloaded(): Promise<boolean> {
  if (!('caches' in self)) return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    for (const path of Object.keys(FILES)) if (!(await isComplete(cache, path))) return false;
    return true;
  } catch {
    return false;
  }
}

/** Scarica i file mancanti; onProgress riceve un valore da 0 a 1. */
export async function download(onProgress?: (p: number) => void, signal?: AbortSignal): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  const total = Object.values(FILES).reduce((a, b) => a + b, 0);
  let done = 0;
  for (const [path, size] of Object.entries(FILES)) {
    const url = fileUrl(path);
    if (await isComplete(cache, path)) {
      done += size;
      onProgress?.(done / total);
      continue;
    }
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) throw new Error(`Download non riuscito (${path}: HTTP ${res.status})`);
    let loaded = 0;
    const base = done;
    // Conta i byte mentre il file passa direttamente nella cache (senza tenerlo tutto in memoria)
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        loaded += chunk.byteLength;
        onProgress?.(Math.min(1, (base + Math.min(loaded, size)) / total));
        ctrl.enqueue(chunk);
      },
    });
    await cache.put(url, new Response(res.body.pipeThrough(counter), { headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream' } }));
    // Download interrotto o incompleto: lo scartiamo, verrà riscaricato
    if (exactSize(path) && loaded !== size) {
      await cache.delete(url);
      throw new Error(`file incompleto (${path}: ${loaded} di ${size} byte). Riprova con una connessione stabile, tenendo l’app aperta`);
    }
    await cache.put(okUrl(path), new Response(String(loaded)));
    done += size;
    onProgress?.(done / total);
  }
}

export async function remove(): Promise<void> {
  await caches.delete(CACHE_NAME);
}

/** Legge un file dalla cache (o dalla rete, se manca). */
export async function readFile(path: string): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(fileUrl(path));
  if (hit) return hit;
  const res = await fetch(fileUrl(path));
  if (!res.ok) throw new Error(`File del modello mancante: ${path}`);
  await cache.put(fileUrl(path), res.clone());
  return res;
}
