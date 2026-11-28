// File del modello Supertonic 3, scaricati una volta e salvati nella Cache del browser.
//
// Due varianti:
// - "full": modelli originali (≈400 MB) da Hugging Face, qualità massima;
// - "lite": per telefoni e tablet (≈190 MB): durata, codifica del testo e flow matching quantizzati in int8
//   (generati durante la pubblicazione dal workflow, vedi scripts/quantize_lite.py), vocoder originale.
//   Verificata con Whisper: trascrizioni identiche all'originale, ~1,5× più veloce, molta meno memoria.

export const REPO_BASE =
  'https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46/';

export type Variant = 'full' | 'lite';

export const VOICE_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

/** File originali: percorso → dimensione in byte. */
const FULL_FILES: Record<string, number> = {
  'onnx/tts.json': 8253,
  'onnx/unicode_indexer.json': 277676,
  'onnx/duration_predictor.onnx': 3700147,
  'onnx/text_encoder.onnx': 36416150,
  'onnx/vector_estimator.onnx': 256534781,
  'onnx/vocoder.onnx': 101424195,
  ...Object.fromEntries(VOICE_IDS.map((v) => [`voice_styles/${v}.json`, 292000])),
};

/** File che nella variante "lite" sono sostituiti da versioni quantizzate pubblicate sul nostro sito. */
const LITE_REPLACED = ['onnx/duration_predictor.onnx', 'onnx/text_encoder.onnx', 'onnx/vector_estimator.onnx'];

/** Dimensioni indicative per l'interfaccia (MB). */
export const VARIANT_MB: Record<Variant, number> = { full: 401, lite: 188 };

const cacheName = (v: Variant) => (v === 'full' ? 'supertonic-3' : 'supertonic-3-lite');
const liteBase = () => new URL(`${import.meta.env.BASE_URL}models/supertonic-lite/`, location.href).href;
const manifestUrl = () => `${liteBase()}manifest.json`;

export function fileUrl(v: Variant, path: string): string {
  return v === 'lite' && LITE_REPLACED.includes(path) ? liteBase() + path : REPO_BASE + path;
}

/** Elenco dei file della variante con le dimensioni (per "lite" lette dal manifest pubblicato). */
async function filesFor(v: Variant, cache?: Cache): Promise<Record<string, number>> {
  if (v === 'full') return FULL_FILES;
  let res = cache ? await cache.match(manifestUrl()) : undefined;
  if (!res) {
    res = await fetch(manifestUrl(), { cache: 'no-cache' });
    if (!res.ok) throw new Error('La versione leggera della voce HD non è disponibile su questo sito');
    if (cache) await cache.put(manifestUrl(), res.clone());
  }
  const lite = (await res.json()) as Record<string, number>;
  return { ...FULL_FILES, ...lite };
}

/** Segnalino salvato solo quando un file è stato scaricato per intero (contiene i byte ricevuti). */
const okUrl = (v: Variant, path: string) => `${fileUrl(v, path)}?scaricato=ok`;
/** File di cui conosciamo la dimensione esatta (le voci variano di poco). */
const exactSize = (path: string) => !path.startsWith('voice_styles/');

async function isComplete(cache: Cache, v: Variant, path: string, size: number): Promise<boolean> {
  const [file, ok] = await Promise.all([cache.match(fileUrl(v, path)), cache.match(okUrl(v, path))]);
  if (!file || !ok) return false;
  const bytes = Number(await ok.text());
  return exactSize(path) ? bytes === size : bytes > 1000;
}

export async function isDownloaded(v: Variant): Promise<boolean> {
  if (!('caches' in self)) return false;
  try {
    const cache = await caches.open(cacheName(v));
    if (v === 'lite' && !(await cache.match(manifestUrl()))) return false;
    const files = await filesFor(v, cache);
    for (const [path, size] of Object.entries(files)) if (!(await isComplete(cache, v, path, size))) return false;
    return true;
  } catch {
    return false;
  }
}

/** Scarica i file mancanti; onProgress riceve un valore da 0 a 1. */
export async function download(v: Variant, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<void> {
  const cache = await caches.open(cacheName(v));
  const files = await filesFor(v, cache);
  const total = Object.values(files).reduce((a, b) => a + b, 0);
  let done = 0;
  for (const [path, size] of Object.entries(files)) {
    const url = fileUrl(v, path);
    if (await isComplete(cache, v, path, size)) {
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
    await cache.put(okUrl(v, path), new Response(String(loaded)));
    done += size;
    onProgress?.(done / total);
  }
}

export async function remove(v: Variant): Promise<void> {
  await caches.delete(cacheName(v));
}

/** Legge un file dalla cache (o dalla rete, se manca). */
export async function readFile(v: Variant, path: string): Promise<Response> {
  const cache = await caches.open(cacheName(v));
  const url = fileUrl(v, path);
  const hit = await cache.match(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`File del modello mancante: ${path}`);
  await cache.put(url, res.clone());
  return res;
}
