import { getSettings, updateSettings, type Settings } from '../settings';
import { deviceEngine, piperEngine } from '../tts';
import { NEURAL_VOICES } from '../tts/neural';
import { ENGINE_FILES_MB, PIPER_VOICES } from '../tts/piper';
import { getCloudStatus } from '../cloud/sync';
import { h, openDialog, toast } from './dom';
import { openAccount } from './account';

function range(label: string, key: 'rate' | 'pitch' | 'volume' | 'fontSize' | 'paragraphPause', min: number, max: number, step: number, fmt: (v: number) => string, hint?: string) {
  const s = getSettings();
  const out = h('output', {}, fmt(s[key]));
  const input = h('input', { type: 'range', min, max, step, value: s[key], 'aria-label': label });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    updateSettings({ [key]: v } as Partial<Settings>);
  });
  return h('div', { class: 'field' }, h('label', {}, label, out), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

export const SPEEDS = [0.5, 0.6, 0.75, 0.85, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** Sezione "Voci del dispositivo": scelta tra le voci del sistema operativo. */
async function deviceSection(): Promise<HTMLElement> {
  const s = getSettings();
  const voices = await deviceEngine.getVoices();
  const select = h('select', { 'aria-label': 'Voce del dispositivo' });
  select.append(h('option', { value: '' }, 'Predefinita del sistema'));
  let lastGroup = '';
  let group: HTMLOptGroupElement | null = null;
  for (const v of voices) {
    const g = v.lang.toLowerCase().startsWith('it') ? 'Italiano' : 'Altre lingue';
    if (g !== lastGroup) {
      group = h('optgroup', { label: g });
      select.append(group);
      lastGroup = g;
    }
    group!.append(h('option', { value: v.id, selected: v.id === s.voiceURI }, `${v.name} (${v.lang})${v.quality === 'alta' ? ' ★' : ''}`));
  }
  select.addEventListener('change', () => updateSettings({ voiceURI: select.value || null }));
  return h(
    'div',
    { class: 'field' },
    h('div', { class: 'label' }, 'Voce del dispositivo'),
    deviceEngine.isSupported() ? select : h('div', { class: 'error-bar' }, 'Questo browser non ha voci di sistema. Usa la voce AI.'),
    h('div', { class: 'hint' }, '★ = voce di qualità migliore. Su Edge cerca le voci “Natural” (es. Isabella, Diego); su Android installa le voci italiane di Google in Impostazioni › Sintesi vocale.'),
  );
}

/** Sezione "Voce AI": scelta, download ed eliminazione delle voci Piper. */
function piperSection(): HTMLElement {
  const list = h('div', { class: 'voice-list' });
  const render = async () => {
    const downloaded = await piperEngine.downloadedVoices();
    const firstDownload = downloaded.length === 0;
    list.replaceChildren();
    for (const v of PIPER_VOICES) {
      const has = downloaded.includes(v.id);
      const selected = getSettings().piperVoice === v.id;
      const radio = h('input', { type: 'radio', name: 'piper-voice', value: v.id, checked: selected, 'aria-label': v.name });
      radio.addEventListener('change', () => updateSettings({ piperVoice: v.id }));
      const status = h('span', { class: 'voice-status' }, has ? '✓ Scaricata' : `${v.sizeMB + (firstDownload ? ENGINE_FILES_MB : 0)} MB`);
      const bar = h('div', { class: 'progress', hidden: true }, h('div', { style: 'width:0%' }));
      const action = has
        ? h('button', {
            class: 'pill',
            onclick: async () => {
              if (!confirm(`Eliminare la voce ${v.name} dal dispositivo?`)) return;
              await piperEngine.removeVoice(v.id);
              render();
            },
          }, 'Elimina')
        : h('button', {
            class: 'pill on',
            onclick: async (e: Event) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.disabled = true;
              bar.hidden = false;
              status.textContent = 'Scarico… 0%';
              try {
                await piperEngine.ensureReady(v.id, (p) => {
                  status.textContent = `Scarico… ${Math.round(p * 100)}%`;
                  (bar.firstElementChild as HTMLElement).style.width = `${Math.round(p * 100)}%`;
                });
                updateSettings({ piperVoice: v.id, engine: 'piper' });
                toast(`Voce ${v.name} pronta`);
              } catch (err) {
                toast(`Download non riuscito: ${err instanceof Error ? err.message : err}`, 6000);
              }
              render();
            },
          }, 'Scarica');
      list.append(
        h('label', { class: 'voice-row' },
          radio,
          h('span', { class: 'voice-name' }, h('strong', {}, v.name), h('small', {}, v.description)),
          status,
          action,
          bar,
        ),
      );
    }
  };
  render();
  return h(
    'div',
    { class: 'field' },
    h('div', { class: 'label' }, 'Voce AI italiana'),
    list,
    h('div', { class: 'hint' },
      'La voce viene scaricata una sola volta e poi funziona offline. Con la voce AI la lettura continua anche a schermo bloccato. ',
      'Sui telefoni meno potenti la prima frase può richiedere qualche secondo. Il tono non è regolabile.'),
  );
}

/** Sezione "Voci neurali": voci Microsoft di qualità quasi umana (online, serve l'account). */
function neuralSection(): HTMLElement {
  const list = h('div', { class: 'voice-list' });
  for (const v of NEURAL_VOICES) {
    const radio = h('input', { type: 'radio', name: 'neural-voice', value: v.id, checked: getSettings().neuralVoice === v.id, 'aria-label': v.name });
    radio.addEventListener('change', () => updateSettings({ neuralVoice: v.id }));
    list.append(
      h('label', { class: 'voice-row' },
        radio,
        h('span', { class: 'voice-name' }, h('strong', {}, v.name), h('small', {}, v.description)),
        h('span', { class: 'voice-status' }, '★ HD'),
      ),
    );
  }
  const logged = !!getCloudStatus().user;
  return h(
    'div',
    { class: 'field' },
    h('div', { class: 'label' }, 'Voci neurali (qualità migliore)'),
    logged
      ? null
      : h('div', { class: 'notice' }, 'Per queste voci serve l’account. ',
          h('button', { class: 'link-btn', type: 'button', onclick: () => openAccount() }, 'Accedi o registrati')),
    list,
    h('div', { class: 'hint' },
      'Voci Microsoft di qualità quasi umana, generate online (serve internet). La lettura continua anche a schermo bloccato.'),
  );
}

export async function openSettings(onPreview?: () => void): Promise<void> {
  const s = getSettings();

  // Scelta del motore
  const engineSel = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Motore vocale' });
  const opts: [Settings['engine'], string][] = [['neural', '★ Neurali'], ['piper', 'AI offline'], ['device', 'Dispositivo']];
  const sections: Record<Settings['engine'], HTMLElement> = { neural: neuralSection(), piper: piperSection(), device: await deviceSection() };
  const pitchField = range('Tono', 'pitch', 0.5, 2, 0.05, (v) => v.toFixed(2));
  const showEngine = (e: Settings['engine']) => {
    sections.device.hidden = e !== 'device';
    sections.piper.hidden = e !== 'piper';
    sections.neural.hidden = e !== 'neural';
    pitchField.hidden = e !== 'device';
    engineSel.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === e)));
  };
  for (const [v, label] of opts) {
    engineSel.append(
      h('button', {
        role: 'radio',
        'data-v': v,
        onclick: () => {
          updateSettings({ engine: v });
          showEngine(v);
        },
      }, label),
    );
  }
  if (!piperEngine.isSupported()) (engineSel.querySelector('[data-v="piper"]') as HTMLButtonElement).disabled = true;

  const preview = h('button', { class: 'btn secondary', onclick: () => onPreview?.() }, 'Prova la voce');

  const speedChips = h('div', { class: 'chips' });
  const rateField = range('Velocità', 'rate', 0.5, 3, 0.05, (v) => `${v.toFixed(2).replace(/\.?0+$/, '')}×`);
  const rateInput = rateField.querySelector('input')!;
  for (const sp of SPEEDS) {
    speedChips.append(
      h('button', {
        class: 'pill',
        onclick: () => {
          rateInput.value = String(sp);
          rateInput.dispatchEvent(new Event('input'));
        },
      }, `${sp}×`),
    );
  }
  rateField.append(h('div', { style: 'margin-top:10px' }, speedChips));

  const theme = h('select', { 'aria-label': 'Tema' },
    h('option', { value: 'auto', selected: s.theme === 'auto' }, 'Automatico'),
    h('option', { value: 'light', selected: s.theme === 'light' }, 'Chiaro'),
    h('option', { value: 'dark', selected: s.theme === 'dark' }, 'Scuro'),
  );
  theme.addEventListener('change', () => updateSettings({ theme: theme.value as Settings['theme'] }));

  const awake = h('input', { type: 'checkbox', checked: s.keepAwake });
  awake.addEventListener('change', () => updateSettings({ keepAwake: awake.checked }));

  openDialog(
    'Impostazioni',
    h(
      'div',
      {},
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Motore vocale'), engineSel),
      sections.neural,
      sections.piper,
      sections.device,
      h('div', { class: 'field' }, preview),
      rateField,
      pitchField,
      range('Volume', 'volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      range('Pausa tra paragrafi', 'paragraphPause', 0, 1500, 50, (v) => `${v} ms`),
      range('Dimensione testo', 'fontSize', 14, 30, 1, (v) => `${v}px`),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Tema'), theme),
      h('div', { class: 'field' },
        h('label', { class: 'switch' }, 'Mantieni lo schermo acceso durante la lettura', awake),
        h('div', { class: 'hint' }, 'Con le voci del dispositivo, sul telefono la lettura si ferma quando lo schermo si blocca: questa opzione lo evita.')),
    ),
  );
  showEngine(s.engine);
}
