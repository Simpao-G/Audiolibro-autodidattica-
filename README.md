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

## Voci migliori (gratis)
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
1. Su GitHub apri *Settings › Pages › Source* e scegli **GitHub Actions**.
2. Fai push sul branch `main`: il workflow `.github/workflows/deploy.yml` pubblica l'app su
   `https://simpao-g.github.io/Audiolibro-autodidattica-/`.
3. Apri il link dal telefono e scegli "Aggiungi a schermata Home".

## Prossimi passi (Fase 2)
- Voce AI di qualità (Kokoro) che gira nel browser, offline.
- Audio generato per capitolo, che continua anche a schermo bloccato.
