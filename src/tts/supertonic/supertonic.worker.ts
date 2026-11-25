/// <reference lib="webworker" />
// Worker che esegue Supertonic 3 (voce AI HD) fuori dal thread principale.
// Pipeline come nel demo ufficiale: durata → codifica testo → flow matching (N passi) → vocoder.
// Build di ONNX Runtime con WebGPU (scheda grafica) e ripiego sul processore (WASM)
import * as ort from 'onnxruntime-web/webgpu';
import { readFile } from './assets';
import { preprocess, toIds } from './text';

export type StRequest =
  | { type: 'init'; id: number; wasmBase: string }
  | { type: 'predict'; id: number; text: string; voice: string; steps: number };

export type StResponse =
  | { type: 'ready'; id: number; backend: string }
  | { type: 'audio'; id: number; wav: Blob; ms: number; audioMs: number }
  | { type: 'error'; id: number; message: string };

interface Config {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { latent_dim: number; chunk_compress_factor: number };
}

interface Style {
  ttl: ort.Tensor;
  dp: ort.Tensor;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let sessions: { dp: ort.InferenceSession; te: ort.InferenceSession; ve: ort.InferenceSession; voc: ort.InferenceSession } | null = null;
let cfg: Config | null = null;
let indexer: number[] = [];
const styles = new Map<string, Style>();
let chain: Promise<unknown> = Promise.resolve();

const post = (m: StResponse) => ctx.postMessage(m);

let backend: 'webgpu' | 'wasm' = 'wasm';

/** La scheda grafica è utilizzabile? (WebGPU) */
async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function loadSession(path: string): Promise<ort.InferenceSession> {
  const model = new Uint8Array(await (await readFile(path)).arrayBuffer());
  if (backend === 'webgpu') {
    try {
      return await ort.InferenceSession.create(model, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
    } catch (e) {
      console.warn('WebGPU non disponibile per', path, e);
      backend = 'wasm';
    }
  }
  return ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

async function init(id: number, wasmBase: string) {
  if (!sessions) {
    ort.env.wasm.wasmPaths = wasmBase;
    // Più thread solo se la pagina lo consente (cross-origin isolation)
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    backend = (await hasWebGpu()) ? 'webgpu' : 'wasm';
    cfg = (await (await readFile('onnx/tts.json')).json()) as Config;
    indexer = (await (await readFile('onnx/unicode_indexer.json')).json()) as number[];
    // Una sessione alla volta: limita i picchi di memoria sui telefoni
    const dp = await loadSession('onnx/duration_predictor.onnx');
    const te = await loadSession('onnx/text_encoder.onnx');
    const ve = await loadSession('onnx/vector_estimator.onnx');
    const voc = await loadSession('onnx/vocoder.onnx');
    sessions = { dp, te, ve, voc };
  }
  post({ type: 'ready', id, backend });
}

async function getStyle(voice: string): Promise<Style> {
  const cached = styles.get(voice);
  if (cached) return cached;
  type Raw = { dims: number[]; data: unknown[] };
  const json = (await (await readFile(`voice_styles/${voice}.json`)).json()) as { style_ttl: Raw; style_dp: Raw };
  const tensor = (r: Raw) => new ort.Tensor('float32', Float32Array.from(r.data.flat(Infinity) as number[]), [1, r.dims[1], r.dims[2]]);
  const style = { ttl: tensor(json.style_ttl), dp: tensor(json.style_dp) };
  styles.set(voice, style);
  return style;
}

/** Numeri casuali con distribuzione normale (Box-Muller). */
function gaussian(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(1e-4, Math.random());
    const u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    out[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

function wav16(pcm: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function predict(id: number, text: string, voice: string, steps: number) {
  if (!sessions || !cfg) throw new Error('Voce AI HD non caricata');
  const t0 = performance.now();
  const ids = toIds(preprocess(text, 'it'), indexer);
  if (!ids.length) throw new Error('Testo non leggibile');
  const L = ids.length;
  const textIds = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, L]);
  const textMask = new ort.Tensor('float32', new Float32Array(L).fill(1), [1, 1, L]);
  const style = await getStyle(voice);

  // 1) Durata della frase (secondi)
  const dpOut = await sessions.dp.run({ text_ids: textIds, style_dp: style.dp, text_mask: textMask });
  const duration = (dpOut.duration.data as Float32Array)[0];

  // 2) Codifica del testo
  const teOut = await sessions.te.run({ text_ids: textIds, style_ttl: style.ttl, text_mask: textMask });
  const textEmb = teOut.text_emb;

  // 3) Rumore iniziale nello spazio latente
  const sr = cfg.ae.sample_rate;
  const chunk = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
  const dim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
  const wavLen = Math.floor(duration * sr);
  const latentLen = Math.max(1, Math.ceil(wavLen / chunk));
  let xt = new ort.Tensor('float32', gaussian(dim * latentLen), [1, dim, latentLen]);
  const latentMask = new ort.Tensor('float32', new Float32Array(latentLen).fill(1), [1, 1, latentLen]);
  const totalStep = new ort.Tensor('float32', new Float32Array([steps]), [1]);

  // 4) Flow matching: il modello "ripulisce" il rumore in N passi
  for (let step = 0; step < steps; step++) {
    const out = await sessions.ve.run({
      noisy_latent: xt,
      text_emb: textEmb,
      style_ttl: style.ttl,
      latent_mask: latentMask,
      text_mask: textMask,
      current_step: new ort.Tensor('float32', new Float32Array([step]), [1]),
      total_step: totalStep,
    });
    xt = new ort.Tensor('float32', out.denoised_latent.data as Float32Array, [1, dim, latentLen]);
  }

  // 5) Vocoder: dallo spazio latente all'audio
  const vocOut = await sessions.voc.run({ latent: xt });
  const pcm = (vocOut.wav_tts.data as Float32Array).subarray(0, wavLen);
  post({ type: 'audio', id, wav: wav16(pcm, sr), ms: Math.round(performance.now() - t0), audioMs: Math.round((pcm.length / sr) * 1000) });
}

ctx.onmessage = (e: MessageEvent<StRequest>) => {
  const msg = e.data;
  chain = chain
    .then(() => (msg.type === 'init' ? init(msg.id, msg.wasmBase) : predict(msg.id, msg.text, msg.voice, msg.steps)))
    .catch((err: unknown) => post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) }));
};
