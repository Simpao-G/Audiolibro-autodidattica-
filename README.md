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

## Account e sincronizzazione (gratis)
Tocca l'icona 👤 in alto e crea un account con email e password. Su ogni dispositivo dove accedi ritrovi:
- i **libri** (salvati in modo privato nel cloud, compressi);
- il **punto di lettura**: riprendi dalla frase esatta dove eri arrivato;
- le **impostazioni**: velocità, voce AI, tema, ecc.

La sincronizzazione è automatica quando sei online, e un libro eliminato sparisce da tutti i dispositivi.
Il backend è un progetto Supabase gratuito (lo schema è in `supabase/migrations/`). Ogni utente vede solo i propri dati, grazie alle regole Row Level Security.
Il piano gratuito include 1 GB di spazio. Se nessuno usa l'app per circa una settimana, il progetto va in pausa e si riattiva dalla dashboard di Supabase.

## ★ Voce AI HD (Supertonic 3), gratis e offline
È la voce di qualità migliore: un modello neurale ([Supertonic 3](https://github.com/supertone-inc/supertonic)) che gira **dentro l'app**, senza server e senza account.
- **10 voci italiane**: ♀ 1-5 e ♂ 1-5.
- **Due versioni**, scelte in automatico ma modificabili in *Voce › ★ AI HD*:
  - **Leggera (circa 190 MB)**, per telefoni e tablet: tre dei quattro modelli sono quantizzati in int8 durante la pubblicazione (`scripts/quantize_lite.py`), mentre il vocoder resta originale. Usa molta meno memoria ed è circa 1,5 volte più veloce. Verificata con Whisper: le trascrizioni sono identiche a quelle della versione completa.
  - **Completa (circa 400 MB)**, per i computer: i modelli originali di Hugging Face.
- **Download**: una volta sola, meglio col Wi-Fi e tenendo l'app aperta. Ogni file viene controllato, e se è incompleto viene riscaricato.
- **Protezione per iPhone/iPad**: se il sistema chiude la pagina per mancanza di memoria durante il caricamento, al riavvio l'app passa alla voce del dispositivo e lo spiega. La voce HD resta in pausa finché non scegli "riprova comunque".
- **Offline**: dopo il download funziona senza internet e continua anche a schermo bloccato.
- **Velocità**: usa la **scheda grafica (WebGPU)** quando c'è (Chrome/Edge su PC, Chrome su Android, Safari su iOS 26). Senza WebGPU usa il processore, ed è più lenta: possono esserci brevi pause tra le frasi.
- **Licenze**: codice MIT, modello OpenRAIL-M.

In *Voce › ★ AI HD* premi "Scarica la voce HD", poi tocca una voce per ascoltarla.

## Voci neurali Azure (facoltative, disattivate)
Sono le voci Microsoft **Isabella, Elsa, Diego e Giuseppe**, di qualità quasi umana. Le genera il servizio ufficiale **Azure Speech**, passando dalla funzione `tts` di Supabase (`supabase/functions/tts`), che tiene nascosta la chiave. Per usarle servono l'account dell'app e internet.

Il piano gratuito **F0** include **500.000 caratteri al mese**, cioè circa 3-4 romanzi. Quando sono finiti il servizio si ferma fino al mese dopo, senza addebiti.

**Configurazione (una volta sola):**
1. Crea un account Azure gratuito. Gli studenti possono usare [Azure for Students](https://azure.microsoft.com/free/students/), che non chiede la carta di credito.
2. Nel portale Azure crea una risorsa **Speech** (Servizi di Azure AI › Speech service):
   - piano tariffario **Free F0**;
   - regione per esempio **West Europe**.
3. Apri la risorsa, poi **Chiavi ed endpoint**, e copia **KEY 1** e la **regione** (es. `westeurope`).
4. Su Supabase apri il progetto *audiolibro*, poi **Edge Functions › Secrets**, e aggiungi:
   - `AZURE_SPEECH_KEY` = la chiave;
   - `AZURE_SPEECH_REGION` = la regione (es. `westeurope`).
5. Nel menu sono nascoste, perché Azure di solito chiede la carta di credito. Per riattivarle, aggiungi `['neural', '★ Neurali']` alle opzioni del motore in `src/ui/settings.ts`.

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
