import {
  cloudUsage,
  getCloudStatus,
  onCloudStatus,
  resetPassword,
  signIn,
  signOut,
  signUp,
  syncNow,
  updatePassword,
} from '../cloud/sync';
import { h, openDialog, toast } from './dom';

function timeAgo(ts: number | null): string {
  if (!ts) return 'mai';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'adesso';
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  return new Date(ts).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Modulo di accesso / registrazione. */
function authForm(close: () => void): HTMLElement {
  let mode: 'login' | 'signup' = 'login';
  const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'nome@esempio.it', required: true, 'aria-label': 'Email' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password (almeno 6 caratteri)', required: true, minlength: 6, 'aria-label': 'Password' });
  const msg = h('div', { class: 'form-msg', role: 'status' });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Accedi');
  const toggle = h('button', { class: 'link-btn', type: 'button' });
  const forgot = h('button', { class: 'link-btn', type: 'button' }, 'Password dimenticata?');
  const title = h('p', { class: 'form-intro' });

  const render = () => {
    submit.textContent = mode === 'login' ? 'Accedi' : 'Crea account';
    toggle.textContent = mode === 'login' ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi';
    password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    title.textContent =
      mode === 'login'
        ? 'Accedi per ritrovare libri e punto di lettura su tutti i tuoi dispositivi.'
        : 'Crea un account gratuito: i tuoi libri e i progressi verranno salvati nel cloud.';
    forgot.hidden = mode !== 'login';
    msg.textContent = '';
    msg.className = 'form-msg';
  };
  toggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'signup' : 'login';
    render();
  });
  forgot.addEventListener('click', async () => {
    if (!email.value) {
      msg.textContent = 'Scrivi prima la tua email qui sopra.';
      msg.className = 'form-msg err';
      return;
    }
    try {
      await resetPassword(email.value.trim());
      msg.textContent = 'Ti abbiamo inviato un’email con il link per scegliere una nuova password.';
      msg.className = 'form-msg ok';
    } catch (e) {
      msg.textContent = e instanceof Error ? e.message : String(e);
      msg.className = 'form-msg err';
    }
  });

  const form = h('form', { class: 'auth-form' }, title, email, password, msg, submit, toggle, forgot);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    msg.textContent = mode === 'login' ? 'Accesso in corso…' : 'Creazione account…';
    msg.className = 'form-msg';
    try {
      if (mode === 'login') {
        await signIn(email.value.trim(), password.value);
        toast('Accesso effettuato: sincronizzo i libri…');
        close();
      } else {
        const needsConfirm = await signUp(email.value.trim(), password.value);
        if (needsConfirm) {
          msg.textContent = `Quasi fatto! Ti abbiamo inviato un’email a ${email.value.trim()}: apri il link per confermare, poi torna qui e accedi.`;
          msg.className = 'form-msg ok';
          mode = 'login';
          submit.textContent = 'Accedi';
          toggle.textContent = 'Non hai un account? Registrati';
        } else {
          toast('Account creato!');
          close();
        }
      }
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
      msg.className = 'form-msg err';
    } finally {
      submit.disabled = false;
    }
  });
  render();
  return form;
}

/** Pannello con l'account collegato. */
function accountInfo(close: () => void): HTMLElement {
  const info = h('div', { class: 'account-info' });
  const usage = h('span', {}, '…');
  const syncBtn = h('button', { class: 'btn', onclick: () => syncNow() }, 'Sincronizza ora');
  const off = onCloudStatus((s) => {
    if (!s.user) return;
    info.replaceChildren(
      h('div', { class: 'account-row' }, h('span', {}, 'Account'), h('strong', {}, s.user.email)),
      h('div', { class: 'account-row' }, h('span', {}, 'Ultima sincronizzazione'), h('strong', {}, s.syncing ? 'in corso…' : timeAgo(s.lastSync))),
      h('div', { class: 'account-row' }, h('span', {}, 'Spazio usato (1 GB gratis)'), usage),
    );
    if (s.error) info.append(h('div', { class: 'error-bar' }, s.error));
    syncBtn.disabled = s.syncing;
  });
  cloudUsage().then((b) => (usage.textContent = formatSize(b))).catch(() => (usage.textContent = '—'));
  const logout = h('button', {
    class: 'btn secondary',
    onclick: async () => {
      if (!confirm('Uscire dall’account? I libri sincronizzati verranno tolti da questo dispositivo, ma restano salvati nel tuo account.')) return;
      off();
      await signOut();
      toast('Sei uscito dall’account');
      close();
    },
  }, 'Esci');
  return h(
    'div',
    {},
    info,
    h('p', { class: 'hint' }, 'Libri, punto di lettura e impostazioni (velocità, voce AI, tema…) si sincronizzano da soli quando sei online.'),
    h('div', { class: 'row-buttons' }, syncBtn, logout),
  );
}

export function openAccount(): void {
  const body = h('div');
  const dlg = openDialog('Account', body);
  const close = () => dlg.close();
  body.append(getCloudStatus().user ? accountInfo(close) : authForm(close));
}

/** Dopo il link "password dimenticata": chiede la nuova password. */
export function openNewPassword(): void {
  const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Nuova password (almeno 6 caratteri)', minlength: 6, required: true, 'aria-label': 'Nuova password' });
  const msg = h('div', { class: 'form-msg' });
  const form = h('form', { class: 'auth-form' }, pw, msg, h('button', { class: 'btn', type: 'submit' }, 'Salva password'));
  const dlg = openDialog('Nuova password', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await updatePassword(pw.value);
      toast('Password aggiornata');
      dlg.close();
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
      msg.className = 'form-msg err';
    }
  });
}
