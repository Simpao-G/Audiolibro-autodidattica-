/// <reference lib="webworker" />
// Worker che esegue la voce AI Piper fuori dal thread principale (l'interfaccia resta fluida).
import { TtsSession } from '@mintplex-labs/piper-tts-web';

export type WorkerRequest =
  | { type: 'init'; id: number; voiceId: string; wasmBase: string }
  | { type: 'predict'; id: number; text: string };

export type WorkerResponse =
  | { type: 'progress'; id: number; loaded: number; total: number }
  | { type: 'ready'; id: number }
  | { type: 'audio'; id: number; wav: Blob }
  | { type: 'error'; id: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let session: TtsSession | null = null;
let currentVoice = '';
// Le richieste vengono eseguite una alla volta, nell'ordine in cui arrivano.
let chain: Promise<unknown> = Promise.resolve();

function post(msg: WorkerResponse) {
  ctx.postMessage(msg);
}

async function init(id: number, voiceId: string, wasmBase: string) {
  if (session && currentVoice === voiceId) return post({ type: 'ready', id });
  // La libreria tiene una sessione unica: la azzeriamo per cambiare voce.
  (TtsSession as unknown as { _instance: TtsSession | null })._instance = null;
  session = null;
  try {
    session = await TtsSession.create({
      voiceId,
      wasmPaths: {
        onnxWasm: wasmBase,
        piperData: `${wasmBase}piper_phonemize.data`,
        piperWasm: `${wasmBase}piper_phonemize.wasm`,
      },
      progress: (p) => {
        if (p.total) post({ type: 'progress', id, loaded: p.loaded, total: p.total });
      },
    });
    currentVoice = voiceId;
    post({ type: 'ready', id });
  } catch (e) {
    (TtsSession as unknown as { _instance: TtsSession | null })._instance = null;
    session = null;
    throw e;
  }
}

async function predict(id: number, text: string) {
  if (!session) throw new Error('Voce AI non caricata');
  const wav = await session.predict(text);
  post({ type: 'audio', id, wav });
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  chain = chain
    .then(() => (msg.type === 'init' ? init(msg.id, msg.voiceId, msg.wasmBase) : predict(msg.id, msg.text)))
    .catch((err: unknown) => post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) }));
};
