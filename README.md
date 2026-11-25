# 🎧 Audiolibro

Carica un libro (**EPUB, PDF o TXT**) e ascoltalo con la sintesi vocale. È **gratis**, non ha bisogno di un server e funziona offline. Si può installare sul telefono come app (PWA).

## Funzioni
- Libreria con copertine e percentuale di avanzamento. I libri restano solo sul tuo dispositivo (IndexedDB).
- Lettura frase per frase, con **evidenziazione** e scorrimento automatico.
- Tocca una frase per iniziare a leggere da lì.
- **Velocità** da 0.5× a 3×, tono, volume, scelta della voce e pausa tra i paragrafi.
- Indice dei capitoli e salti avanti/indietro per frase o per capitolo.
- Ripresa automatica dal punto in cui eri rimasto.
- Timer di spegnimento: 15, 30, 45 o 60 minuti, oppure a fine capitolo.
- Tema chiaro/scuro e dimensione del testo.
- Opzione per tenere lo schermo acceso, così la lettura non si ferma sul telefono.
- Controlli multimediali dalle cuffie e dalla tastiera, scorciatoie da tastiera (spazio, ←, →).

## Voce AI offline (Piper)
In *Impostazioni › Motore vocale* scegli **Voce AI (offline)** e scarica una voce italiana:
- **Paola**: femminile, qualità buona (circa 63 MB).
- **Riccardo**: maschile, qualità base ma più veloce (circa 28 MB).

La prima volta si scaricano anche i file del motore (circa 34 MB). Dopo, tutto funziona senza internet.
L'audio viene generato sul dispositivo e riprodotto come un file audio vero. Così la lettura **continua anche a schermo bloccato**, con i controlli nella schermata di blocco e dalle cuffie.

## Voci del dispositivo (gratis)
- **Microsoft Edge**: ha voci "Natural" molto realistiche (Isabella, Diego, Elsa).
- **Android**: installa i dati vocali italiani di Google da *Impostazioni › Sistema › Lingue › Sintesi vocale*.
- **iPhone**: *Impostazioni › Accessibilità › Contenuti letti › Voci › Italiano* e scarica una voce "Avanzata".

## Sviluppo
```bash
npm install
npm run dev      # http://localhost:5173
npm test         # test unitari
npm run build    # build di produzione in dist/
```

## Pubblicazione gratuita su GitHub Pages
1. A ogni push su `main` il workflow `.github/workflows/deploy.yml` compila l'app e la pubblica sul branch `gh-pages`.
2. Su GitHub apri *Settings › Pages*. Imposta *Source* su **Deploy from a branch** e scegli il branch **gh-pages** con la cartella **/ (root)**.
3. L'app sarà su `https://simpao-g.github.io/Audiolibro-autodidattica-/`. Aprila dal telefono e scegli "Aggiungi a schermata Home".

## Crediti
- Voci e modelli: [Piper](https://github.com/rhasspy/piper) (licenza MIT), eseguiti con [piper-tts-web](https://github.com/Mintplex-Labs/piper-tts-web) e ONNX Runtime Web.
