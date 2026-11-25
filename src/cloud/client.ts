import { createClient } from '@supabase/supabase-js';

// Progetto Supabase "audiolibro". La chiave "publishable" è fatta per stare nel browser:
// i dati sono protetti dalle regole Row Level Security (ogni utente vede solo i suoi).
export const SUPABASE_URL = 'https://hgwkitoewmkfybknvtkz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_RXR9YPb1-ywiar51wyzayQ_O4vVNl1x';
export const BUCKET = 'books';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'audiolibro-auth',
  },
});
