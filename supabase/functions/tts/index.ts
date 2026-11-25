// Edge Function "tts": trasforma una frase in audio MP3 con le voci neurali di
// Microsoft Azure Speech (servizio ufficiale; il piano gratuito F0 include 500.000 caratteri al mese).
// La chiave Azure resta qui sul server (segreti AZURE_SPEECH_KEY e AZURE_SPEECH_REGION),
// e la funzione è usabile solo da utenti con account dell'app.
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

const MAX_CHARS = 1200;

/** Voci italiane disponibili. */
const VOICES = new Set([
  'it-IT-IsabellaNeural',
  'it-IT-ElsaNeural',
  'it-IT-DiegoNeural',
  'it-IT-GiuseppeMultilingualNeural',
]);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Usa POST' });

  const key = Deno.env.get('AZURE_SPEECH_KEY');
  const region = Deno.env.get('AZURE_SPEECH_REGION');
  if (!key || !region) {
    return json(503, { error: 'Voci neurali non ancora configurate: manca la chiave Azure Speech sul server.', code: 'not_configured' });
  }

  // Solo utenti registrati dell'app
  const auth = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data: userData, error: authError } = await supabase.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  if (authError || !userData.user) return json(401, { error: 'Accedi al tuo account per usare le voci neurali.' });

  let body: { text?: string; voice?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Richiesta non valida' });
  }
  const text = (body.text ?? '').trim();
  const voice = body.voice ?? 'it-IT-IsabellaNeural';
  if (!text) return json(400, { error: 'Testo vuoto' });
  if (text.length > MAX_CHARS) return json(400, { error: `Testo troppo lungo (max ${MAX_CHARS} caratteri)` });
  if (!VOICES.has(voice)) return json(400, { error: 'Voce non disponibile' });

  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='it-IT'>` +
    `<voice name='${voice}'>${escapeXml(text)}</voice></speak>`;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'audiolibro',
    },
    body: ssml,
  });
  if (!res.ok) {
    const detail = res.status === 429
      ? 'Limite gratuito di Azure raggiunto (troppe richieste o caratteri del mese esauriti). Riprova più tardi.'
      : res.status === 401
        ? 'Chiave Azure Speech non valida o regione sbagliata.'
        : `Errore del servizio vocale Azure (HTTP ${res.status}).`;
    return json(502, { error: detail, status: res.status });
  }
  return new Response(res.body, {
    headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400' },
  });
});
