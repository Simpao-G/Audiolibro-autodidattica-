import { getSettings, updateSettings, type Settings } from '../settings';
import { deviceEngine, piperEngine, supertonicEngine } from '../tts';
import { SUPERTONIC_MB, SUPERTONIC_VOICES } from '../tts/supertonic';
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
  select.append(h('option', { value: '' }, 'Automatica (la migliore italiana)'));
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
    h('div', { class: 'hint' }, '★ = voce di qualità migliore. Con “Automatica” l’app sceglie da sola la voce italiana migliore.'),
    h('details', { class: 'guide' },
      h('summary', {}, 'Come avere voci migliori gratis sul tuo dispositivo'),
      h('ul', {},
        h('li', {}, h('strong', {}, 'iPhone/iPad: '), 'Impostazioni › Accessibilità › Contenuti letti › Voci › Italiano: scarica “Alice (Ottimizzata)” oppure “Federica/Luca (Premium)”.'),
        h('li', {}, h('strong', {}, 'Android: '), 'Impostazioni › Sistema › Lingue › Output sintesi vocale › Google › Installa dati vocali › Italiano, poi scegli una voce.'),
        h('li', {}, h('strong', {}, 'PC: '), 'apri l’app con Microsoft Edge: trovi gratis le voci “Isabella / Elsa / Diego Online (Natural)”, di qualità molto alta.'),
      ),
    ),
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

/** Sezione "AI HD": Supertonic 3, voce neurale offline di alta qualità. */
function supertonicSection(onPreview?: () => void): HTMLElement {
  const box = h('div', {});
  const render = async () => {
    const has = await supertonicEngine.isDownloaded();
    box.replaceChildren();
    if (!has) {
      const status = h('span', { class: 'voice-status' }, `${SUPERTONIC_MB} MB`);
      const bar = h('div', { class: 'progress', hidden: true }, h('div', { style: 'width:0%' }));
      const btn = h('button', { class: 'btn' }, 'Scarica la voce HD');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        bar.hidden = false;
        try {
          await supertonicEngine.download((p) => {
            status.textContent = `Scarico… ${Math.round(p * 100)}%`;
            (bar.firstElementChild as HTMLElement).style.width = `${Math.round(p * 100)}%`;
          });
          updateSettings({ engine: 'supertonic' });
          toast('Voce AI HD pronta!');
        } catch (err) {
          toast(`Download non riuscito: ${err instanceof Error ? err.message : err}`, 6000);
        }
        render();
      });
      box.append(
        h('div', { class: 'notice' },
          h('strong', {}, 'Voce AI di alta qualità, gratis e offline. '),
          `Si scarica una volta sola (circa ${SUPERTONIC_MB} MB, meglio col Wi-Fi), poi funziona anche senza internet e a schermo bloccato.`),
        h('div', { class: 'row-buttons' }, btn, status),
        bar,
      );
      return;
    }
    const list = h('div', { class: 'voice-grid' });
    for (const v of SUPERTONIC_VOICES) {
      const b = h('button', {
        class: getSettings().supertonicVoice === v.id ? 'pill on' : 'pill',
        onclick: () => {
          updateSettings({ supertonicVoice: v.id });
          list.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          onPreview?.();
        },
      }, `${v.id.startsWith('F') ? '♀' : '♂'} ${v.id.slice(1)}`);
      list.append(b);
    }
    const accel = supertonicEngine.backend === 'webgpu'
      ? h('div', { class: 'hint' }, '⚡ Usa la scheda grafica: lettura fluida.')
      : supertonicEngine.backend === 'wasm'
        ? h('div', { class: 'notice' }, 'Questo dispositivo non offre l’accelerazione grafica (WebGPU): la voce HD può fare brevi pause tra le frasi. Prova con Chrome o Edge aggiornati, oppure usa “AI leggera” o “Dispositivo”.')
        : null;
    box.append(
      h('div', { class: 'hint', style: 'margin:0 0 8px' }, 'Tocca una voce per ascoltarla: ♀ = femminile, ♂ = maschile.'),
      list,
      h('div', { class: 'row-buttons' },
        h('span', { class: 'voice-status' }, '✓ Scaricata'),
        h('button', {
          class: 'pill',
          onclick: async () => {
            if (!confirm('Eliminare la voce AI HD dal dispositivo? Potrai riscaricarla quando vuoi.')) return;
            await supertonicEngine.removeModel();
            if (getSettings().engine === 'supertonic') updateSettings({ engine: 'device' });
            render();
          },
        }, 'Elimina'),
      ),
    );
    if (accel) box.append(accel);
  };
  render();
  return h('div', { class: 'field' }, h('div', { class: 'label' }, 'Voce AI HD (Supertonic 3)'), box);
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
  // Le voci Azure ("neural") restano nel codice ma non sono nel menu: richiedono un account a pagamento.
  const opts: [Settings['engine'], string][] = [['supertonic', '★ AI HD'], ['piper', 'AI leggera'], ['device', 'Dispositivo']];
  const sections: Record<Settings['engine'], HTMLElement> = {
    supertonic: supertonicSection(onPreview),
    neural: neuralSection(),
    piper: piperSection(),
    device: await deviceSection(),
  };
  if (s.engine === 'neural') updateSettings({ engine: 'device' });
  const pitchField = range('Tono', 'pitch', 0.5, 2, 0.05, (v) => v.toFixed(2));
  const showEngine = (e: Settings['engine']) => {
    sections.device.hidden = e !== 'device';
    sections.piper.hidden = e !== 'piper';
    sections.neural.hidden = true;
    sections.supertonic.hidden = e !== 'supertonic';
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
      sections.supertonic,
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
  showEngine(getSettings().engine);
}
