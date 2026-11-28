"""Crea la versione "leggera" della voce AI HD (Supertonic 3) per telefoni e tablet.

Scarica i modelli originali da Hugging Face (revisione fissata) e quantizza in int8 dinamico
durata, codifica del testo e flow matching. Il vocoder resta originale: in int8 l'audio si rovina.
Verifica fatta con Whisper: trascrizioni identiche al modello originale.

Uso:  python scripts/quantize_lite.py public/models/supertonic-lite
Scrive <cartella>/onnx/*.onnx e <cartella>/manifest.json (percorso -> dimensione in byte).
"""

import json
import os
import sys
import tempfile
import urllib.request

from onnxruntime.quantization import QuantType, quantize_dynamic

REPO = "https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46/onnx/"
MODELS = ["duration_predictor", "text_encoder", "vector_estimator"]


def main(out_dir: str) -> None:
    os.makedirs(os.path.join(out_dir, "onnx"), exist_ok=True)
    manifest = {}
    with tempfile.TemporaryDirectory() as tmp:
        for name in MODELS:
            src = os.path.join(tmp, f"{name}.onnx")
            print(f"scarico {name}…", flush=True)
            urllib.request.urlretrieve(REPO + f"{name}.onnx", src)
            dst = os.path.join(out_dir, "onnx", f"{name}.onnx")
            quantize_dynamic(
                src,
                dst,
                weight_type=QuantType.QUInt8,
                per_channel=False,
                op_types_to_quantize=["MatMul", "Gemm", "Conv"],
            )
            manifest[f"onnx/{name}.onnx"] = os.path.getsize(dst)
            print(f"  {name}: {os.path.getsize(src) // 1_000_000} MB -> {manifest[f'onnx/{name}.onnx'] // 1_000_000} MB", flush=True)
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("manifest:", manifest)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "public/models/supertonic-lite")
