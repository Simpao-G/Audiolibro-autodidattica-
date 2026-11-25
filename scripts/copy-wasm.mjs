// Copia i file WebAssembly della voce AI (Piper) in public/wasm/, così l'app li serve da sola
// (niente CDN esterni, e il service worker li può salvare per l'uso offline).
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'public', 'wasm');
mkdirSync(out, { recursive: true });

const ortDir = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const piperDir = join(root, 'node_modules', '@diffusionstudio', 'piper-wasm', 'build');

const files = [
  [ortDir, 'ort-wasm-simd-threaded.mjs'],
  [ortDir, 'ort-wasm-simd-threaded.wasm'],
  [piperDir, 'piper_phonemize.wasm'],
  [piperDir, 'piper_phonemize.data'],
];
for (const [dir, name] of files) copyFileSync(join(dir, name), join(out, name));
console.log(`copy-wasm: ${files.length} file copiati in public/wasm/`);
